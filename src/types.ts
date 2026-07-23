export type DependencyErrorContext = Record<string, unknown>;

export type QuotePriceRequest = {
  sku: string;
  quantity: number;
  customerTier: string;
};

export type QuotePriceResponse = {
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
};

export type GraphQLQuotePriceArgs = {
  sku: string;
  quantity: number;
};
