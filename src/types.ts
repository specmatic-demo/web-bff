export type JsonObject = Record<string, unknown>;

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

export type CustomerRecord = {
  id: string;
  email: string;
  tier: string;
};

export type PlaceOrderInput = {
  customerId: string;
  sku: string;
  quantity: number;
  paymentMethodId: string;
};

export type ScheduleReturnInput = {
  orderId: string;
  customerId: string;
  sku: string;
  quantity: number;
  reasonCode: string;
};

export type OrderRecord = {
  id: string;
  status: string;
};

export type UserNotification = {
  notificationId: string;
  requestId: string;
  title: string;
  body: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
};

export type GraphQLCustomerArgs = { id: string };
export type GraphQLCatalogItemsArgs = { category?: string | null; limit?: number | null };
export type GraphQLOrderArgs = { id: string };
export type GraphQLQuotePriceArgs = { sku: string; quantity: number };
export type GraphQLPlaceOrderArgs = { input: PlaceOrderInput };
export type GraphQLScheduleReturnArgs = { input: ScheduleReturnInput };
export type GraphQLOrdersArgs = { customerId: string; status?: string | null; from?: string | null; to?: string | null };
export type GraphQLCancelOrderArgs = { orderId: string; reason?: string | null };
export type GraphQLRequestRefundArgs = { paymentId: string; amount: number; reason: string };
