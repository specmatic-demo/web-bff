import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import express, { type NextFunction, type Request, type Response } from 'express';
import { buildSchema } from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';
import type { DependencyErrorContext, GraphQLQuotePriceArgs, QuotePriceRequest, QuotePriceResponse } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findFirstExistingPath(paths: Array<string | undefined>): string | null {
  for (const candidate of paths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const schemaPath = findFirstExistingPath([
  process.env.BFF_SCHEMA_PATH,
  path.join(__dirname, '..', 'specs', 'schema.graphql')
]);

if (!schemaPath) {
  throw new Error('Could not find GraphQL schema file. Set BFF_SCHEMA_PATH if needed.');
}

console.log(`Using GraphQL schema from ${schemaPath}`);

const pricingProtoPath = findFirstExistingPath([
  process.env.PRICING_PROTO_PATH,
  path.join(__dirname, '..', '.specmatic', 'repos', 'pricing-service', 'specs', 'pricing.proto'),
  path.join(__dirname, '..', '..', 'pricing-service', 'specs', 'pricing.proto')
]);

if (!pricingProtoPath) {
  throw new Error('Could not find pricing proto file. Set PRICING_PROTO_PATH if needed.');
}

const schema = buildSchema(fs.readFileSync(schemaPath, 'utf8'));

const config = {
  host: process.env.BFF_HOST || '0.0.0.0',
  port: Number.parseInt(process.env.BFF_PORT || '4000', 10),
  pricingServiceAddress: process.env.PRICING_SERVICE_ADDRESS || 'localhost:5104'
};

function logDependencyError(
  dependency: string,
  endpoint: string,
  error: unknown,
  context: DependencyErrorContext = {}
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[dependency-error] dependency=${dependency} endpoint=${endpoint} message="${message}" context=${JSON.stringify(context)}`
  );
}

console.log(`Dependency configuration: pricing=${config.pricingServiceAddress}`);

const pricingPackageDef = protoLoader.loadSync(pricingProtoPath, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const pricingProto = grpc.loadPackageDefinition(pricingPackageDef) as any;
const PricingServiceClient = pricingProto.pricing.v1.PricingService;
const pricingClient = new PricingServiceClient(
  config.pricingServiceAddress,
  grpc.credentials.createInsecure()
);

function quotePriceGrpc(request: QuotePriceRequest): Promise<QuotePriceResponse> {
  return new Promise((resolve, reject) => {
    pricingClient.quotePrice(request, (error: Error | null, response: QuotePriceResponse) => {
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

const rootValue = {
  quotePrice: async ({ sku, quantity }: GraphQLQuotePriceArgs) => {
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
  }
};

const app = express();

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  console.log(`[incoming-request] id=${requestId} method=${req.method} path=${req.originalUrl} ip=${ip}`);

  res.on('finish', () => {
    console.log(
      `[request-complete] id=${requestId} method=${req.method} path=${req.originalUrl} status=${res.statusCode} durationMs=${Date.now() - startedAt}`
    );
  });

  next();
});

app.get('/health', (_req: Request, res: Response) => {
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
    pricingClient.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
