import { Provider, PaymentProvider } from './types.js';
import { MockProvider } from './mock.js';
import { AlipayProvider } from './alipay.js';
import { WeChatProvider } from './wechat.js';
import { PayPalProvider } from './paypal.js';

export function providerFor(name: string): PaymentProvider {
  switch (name) {
    case 'mock': return new MockProvider();
    case 'alipay': return new AlipayProvider();
    case 'wechat': return new WeChatProvider();
    case 'paypal': return new PayPalProvider();
    default: throw new Error(`未知支付渠道：${name}`);
  }
}

export const PROVIDERS: Provider[] = ['mock', 'wechat', 'alipay', 'paypal'];

export type { Provider, ChannelConfig, CheckoutInput, CheckoutResult, PaymentProvider } from './types.js';
export * from './types.js';
