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
  host: process.env.BFF_HOST || 'localhost',
  port: Number.parseInt(process.env.BFF_PORT || '4000', 10),
  customerServiceBaseUrl: process.env.CUSTOMER_SERVICE_BASE_URL || 'http://localhost:5101',
  catalogServiceBaseUrl: process.env.CATALOG_SERVICE_BASE_URL || 'http://localhost:5102',
  orderServiceBaseUrl: process.env.ORDER_SERVICE_BASE_URL || 'http://localhost:5103',
  pricingServiceAddress: process.env.PRICING_SERVICE_ADDRESS || 'localhost:5104',
  notificationBrokerUrl: process.env.NOTIFICATION_BROKER_URL || 'mqtt://localhost:1883'
};

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

    client.once('connect', () => {
      mqttClient = client;
      resolve(client);
    });

    client.once('error', (error) => {
      reject(error);
    });
  });

  return mqttReadyPromise;
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let details = '';
    try {
      details = await response.text();
    } catch (error) {
      details = '';
    }

    throw new Error(`Upstream call failed (${response.status}) for ${url}${details ? `: ${details}` : ''}`);
  }

  return response.json();
}

function quotePriceGrpc(request) {
  return new Promise((resolve, reject) => {
    pricingClient.quotePrice(request, (error, response) => {
      if (error) {
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

    if (category) {
      params.set('category', category);
    }

    params.set('limit', String(limit));

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
