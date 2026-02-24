const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const express = require('express');
const { buildSchema } = require('graphql');
const { createHandler } = require('graphql-http/lib/use/express');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const mqtt = require('mqtt');

function findFirstExistingPath(paths) {
  for (const candidate of paths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const schemaPath = findFirstExistingPath([
  process.env.BFF_SCHEMA_PATH,
  path.join(
    __dirname,
    '..',
    '.specmatic',
    'repos',
    'central-contract-repository',
    'contracts',
    'services',
    'web-bff',
    'graphql',
    'schema.graphql'
  ),
  path.join(
    __dirname,
    '..',
    '..',
    'central-contract-repository',
    'contracts',
    'services',
    'web-bff',
    'graphql',
    'schema.graphql'
  )
]);

if (!schemaPath) {
  throw new Error('Could not find GraphQL schema file. Set BFF_SCHEMA_PATH if needed.');
}

console.log(`Using GraphQL schema from ${schemaPath}`);

const pricingProtoPath = findFirstExistingPath([
  process.env.PRICING_PROTO_PATH,
  path.join(
    __dirname,
    '..',
    '.specmatic',
    'repos',
    'central-contract-repository',
    'contracts',
    'services',
    'pricing-service',
    'rpc',
    'pricing.proto'
  ),
  path.join(
    __dirname,
    '..',
    '..',
    'central-contract-repository',
    'contracts',
    'services',
    'pricing-service',
    'rpc',
    'pricing.proto'
  )
]);

if (!pricingProtoPath) {
  throw new Error('Could not find pricing proto file. Set PRICING_PROTO_PATH if needed.');
}

const schemaSource = fs.readFileSync(schemaPath, 'utf8');
const schema = buildSchema(schemaSource);

const config = {
  host: process.env.BFF_HOST || '0.0.0.0',
  port: Number.parseInt(process.env.BFF_PORT || '4000', 10),
  customerServiceBaseUrl: process.env.CUSTOMER_SERVICE_BASE_URL || 'http://localhost:5101',
  catalogServiceBaseUrl: process.env.CATALOG_SERVICE_BASE_URL || 'http://localhost:5102',
  orderServiceBaseUrl: process.env.ORDER_SERVICE_BASE_URL || 'http://localhost:5103',
  pricingServiceAddress: process.env.PRICING_SERVICE_ADDRESS || 'localhost:5104',
  notificationBrokerUrl: process.env.NOTIFICATION_BROKER_URL || 'mqtt://localhost:1883'
};

function logDependencyError(dependency, endpoint, error, context = {}) {
  const message = error && error.message ? error.message : String(error);
  console.error(
    `[dependency-error] dependency=${dependency} endpoint=${endpoint} message="${message}" context=${JSON.stringify(
      context
    )}`
  );
}

console.log(
  `Dependency configuration: customer=${config.customerServiceBaseUrl}, catalog=${config.catalogServiceBaseUrl}, order=${config.orderServiceBaseUrl}, pricing=${config.pricingServiceAddress}, mqtt=${config.notificationBrokerUrl}`
);

const pricingPackageDef = protoLoader.loadSync(pricingProtoPath, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const pricingProto = grpc.loadPackageDefinition(pricingPackageDef);
const PricingServiceClient = pricingProto.pricing.v1.PricingService;
const pricingClient = new PricingServiceClient(config.pricingServiceAddress, grpc.credentials.createInsecure());

let mqttClient;
let mqttReadyPromise;

function getMqttClient() {
  if (mqttClient) {
    return Promise.resolve(mqttClient);
  }

  if (mqttReadyPromise) {
    return mqttReadyPromise;
  }

  mqttReadyPromise = new Promise((resolve, reject) => {
    const client = mqtt.connect(config.notificationBrokerUrl);

    client.on('reconnect', () => {
      console.warn(`[dependency-warning] dependency=notificationService endpoint=${config.notificationBrokerUrl} reconnecting`);
    });

    client.on('offline', () => {
      console.warn(`[dependency-warning] dependency=notificationService endpoint=${config.notificationBrokerUrl} offline`);
    });

    client.once('connect', () => {
      console.log(`[dependency-connected] dependency=notificationService endpoint=${config.notificationBrokerUrl}`);
      mqttClient = client;
      resolve(client);
    });

    client.once('error', (error) => {
      logDependencyError('notificationService', config.notificationBrokerUrl, error, {
        phase: 'connect'
      });
      reject(error);
    });
  });

  return mqttReadyPromise;
}

async function httpJson(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    });
  } catch (error) {
    logDependencyError('httpDependency', url, error, {
      method: options.method || 'GET',
      phase: 'connect'
    });
    throw error;
  }

  if (!response.ok) {
    let details = '';
    try {
      details = await response.text();
    } catch (error) {
      details = '';
    }

    const error = new Error(`Upstream call failed (${response.status}) for ${url}${details ? `: ${details}` : ''}`);
    logDependencyError('httpDependency', url, error, {
      method: options.method || 'GET',
      phase: 'response',
      status: response.status
    });
    throw error;
  }

  return response.json();
}

function quotePriceGrpc(request) {
  return new Promise((resolve, reject) => {
    pricingClient.quotePrice(request, (error, response) => {
      if (error) {
        logDependencyError('pricingService', config.pricingServiceAddress, error, {
          method: 'QuotePrice',
          request
        });
        reject(error);
        return;
      }

      resolve(response);
    });
  });
}

async function publishUserNotification(payload) {
  const client = await getMqttClient();

  return new Promise((resolve, reject) => {
    client.publish('notification/user', JSON.stringify(payload), { qos: 1 }, (error) => {
      if (error) {
        logDependencyError('notificationService', config.notificationBrokerUrl, error, {
          phase: 'publish',
          topic: 'notification/user',
          requestId: payload.requestId
        });
        reject(error);
        return;
      }

      resolve();
    });
  });
}

const rootValue = {
  customer: async ({ id }) => {
    return httpJson(`${config.customerServiceBaseUrl}/customers/${encodeURIComponent(id)}`, {
      method: 'GET'
    });
  },

  catalogItems: async ({ category, limit = 10 }) => {
    const params = new URLSearchParams();
    const parsedLimit = Number.parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(100, Math.max(1, parsedLimit))
      : 10;

    if (category) {
      params.set('category', category);
    }

    params.set('limit', String(safeLimit));

    const url = `${config.catalogServiceBaseUrl}/catalog/items?${params.toString()}`;
    return httpJson(url, { method: 'GET' });
  },

  order: async ({ id }) => {
    return httpJson(`${config.orderServiceBaseUrl}/orders/${encodeURIComponent(id)}`, {
      method: 'GET'
    });
  },

  quotePrice: async ({ sku, quantity }) => {
    const quote = await quotePriceGrpc({
      sku,
      quantity,
      customerTier: 'STANDARD'
    });

    return {
      sku: quote.sku,
      quantity: quote.quantity,
      unitPrice: quote.unitPrice,
      totalPrice: quote.totalPrice
    };
  },

  placeOrder: async ({ input }) => {
    const customer = await httpJson(
      `${config.customerServiceBaseUrl}/customers/${encodeURIComponent(input.customerId)}`,
      { method: 'GET' }
    );

    const quote = await quotePriceGrpc({
      sku: input.sku,
      quantity: input.quantity,
      customerTier: customer.tier || 'STANDARD'
    });

    const order = await httpJson(`${config.orderServiceBaseUrl}/orders`, {
      method: 'POST',
      body: JSON.stringify({
        customerId: input.customerId,
        paymentMethodId: input.paymentMethodId,
        items: [
          {
            sku: input.sku,
            quantity: input.quantity,
            unitPrice: quote.unitPrice
          }
        ]
      })
    });

    await publishUserNotification({
      notificationId: randomUUID(),
      requestId: order.id,
      title: 'Order placed',
      body: `Order ${order.id} was placed with status ${order.status}`,
      priority: 'NORMAL'
    });

    return {
      orderId: order.id,
      status: order.status
    };
  }
};

const app = express();

app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  console.log(
    `[incoming-request] id=${requestId} method=${req.method} path=${req.originalUrl} ip=${ip}`
  );

  res.on('finish', () => {
    console.log(
      `[request-complete] id=${requestId} method=${req.method} path=${req.originalUrl} status=${res.statusCode} durationMs=${Date.now() - startedAt}`
    );
  });

  next();
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(
  '/graphql',
  createHandler({
    schema,
    rootValue
  })
);

const server = app.listen(config.port, config.host, () => {
  console.log(`web-bff listening on http://${config.host}:${config.port}/graphql`);
});

function shutdown() {
  server.close(() => {
    if (mqttClient) {
      mqttClient.end(true);
    }

    pricingClient.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
