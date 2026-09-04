export type Provider = 'mock' | 'wechat' | 'alipay' | 'paypal';
export type ChannelConfig = Record<string, string | number | boolean>;

export interface CheckoutInput {
  orderNo: string;
  amountCents: number;
  title: string;
  notifyUrl: string;
  description?: string;
}

export interface CheckoutResult {
  provider: Provider;
  /* 跳转链接（微信 H5 / 支付宝 WAP / PayPal 下单链接） */
  checkoutUrl?: string;
  /* 二维码内容（微信 Native / 支付宝当面付） */
  qrCode?: string;
  /* 交易号 */
  tradeNo?: string;
}

export interface OrderQueryResult {
  paid: boolean;
  tradeStatus: string;
  providerTradeNo: string | null;
}

export interface PaymentProvider {
  readonly name: Provider;
  validateConfig(config: ChannelConfig): string[];
  createCheckout(input: CheckoutInput, config: ChannelConfig): Promise<CheckoutResult>;
  /* 验签回调：headers(小写) / rawBody / config，返回成功处理结果或抛错 */
  verifyWebhook(headers: Record<string, string | undefined>, body: string, config: ChannelConfig): { eventId: string; orderNo: string; paid: boolean; amountCents?: number; providerTradeNo?: string | null };
  /* 主动查单 */
  queryOrder(orderNo: string, config: ChannelConfig): Promise<OrderQueryResult>;
  /* 连接测试：返回逐项检测清单（与 CRM/Nova-key testChannel 一致） */
  testConnection(config: ChannelConfig): Promise<{ success: boolean; message: string; items: Array<{ name: string; status: boolean; message: string }> }>;
}
