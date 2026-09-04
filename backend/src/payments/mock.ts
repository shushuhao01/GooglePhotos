import { PaymentProvider, CheckoutInput, ChannelConfig } from './types.js';

export class MockProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  validateConfig() { return []; }
  async createCheckout(i: CheckoutInput) {
    return { provider: this.name, checkoutUrl: `/api/v1/billing/mock-pay/${encodeURIComponent(i.orderNo)}`, tradeNo: 'mock_' + i.orderNo };
  }
  verifyWebhook(_headers: Record<string, string | undefined>, body: string) {
    const d = JSON.parse(body || '{}');
    return { eventId: 'mock_' + (d.orderNo || Date.now()), orderNo: String(d.orderNo || ''), paid: !!d.paid };
  }
  async queryOrder(_orderNo: string) { return { paid: false, tradeStatus: 'pending', providerTradeNo: null }; }
  async testConnection(_config: ChannelConfig) {
    return { success: true, message: 'Mock 支付始终可用', items: [{ name: 'Mock 通道', status: true, message: '仅用于开发阶段验证流程' }] };
  }
}
