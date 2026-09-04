import { PaymentProvider, CheckoutInput, ChannelConfig } from './types.js';

function base(envName: string): string {
  return (envName || 'sandbox') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}
function tokenUrl(envName: string): string {
  return base(envName) + '/v1/oauth2/token';
}

/* 获取 access token */
async function getAccessToken(clientId: string, secret: string, envName: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const resp = await fetch(tokenUrl(envName), {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) throw new Error(`PayPal 认证失败：${json.error_description || json.error || resp.status}`);
  return json.access_token;
}

export class PayPalProvider implements PaymentProvider {
  readonly name = 'paypal' as const;
  validateConfig(c: ChannelConfig) {
    return ['clientId', 'clientSecret'].filter(k => !String(c[k] || '').trim());
  }
  private cfg(c: ChannelConfig) {
    const cc = c as unknown as Record<string, string>;
    return { clientId: cc.clientId || '', clientSecret: cc.clientSecret || '', environment: cc.environment || 'sandbox', notifyUrl: cc.notifyUrl || '' };
  }
  private async token(c: ReturnType<PayPalProvider['cfg']>): Promise<string> {
    const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
    const resp = await fetch(tokenUrl(c.environment), { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.access_token) throw new Error(`PayPal 认证失败：${json.error_description || json.error || resp.status}`);
    return json.access_token;
  }
  private async req(method: string, path: string, url: string, body?: Record<string, unknown>, token?: string) {
    const resp = await fetch(url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`PayPal API ${resp.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  }

  async createCheckout(input: CheckoutInput, config: ChannelConfig) {
    const c = this.cfg(config);
    const accessToken = await this.token(c);
    const body = {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: input.orderNo, amount: { currency_code: 'USD', value: (input.amountCents / 100).toFixed(2) }, description: input.title }],
    };
    const resp = await this.req('POST', '/v2/checkout/orders', base(c.environment) + '/v2/checkout/orders', body, accessToken);
    return { provider: this.name, checkoutUrl: (resp.links || []).find((l: any) => l.rel === 'approve')?.href, tradeNo: resp.id };
  }

  verifyWebhook(_headers: Record<string, string | undefined>, body: string, config: ChannelConfig) {
    const c = this.cfg(config);
    const json = JSON.parse(body || '{}');
    const eventType = String(json.event_type || '');
    const resource: any = json.resource || {};
    // PayPal Webhook 验签需调用 /v1/notifications/verify-webhook-signature（配置 webhookId）
    // 此处做基础字段解析 + 订单状态判断，生产需配置 webhookId 严格验签
    const paid = ['PAYMENT.CAPTURE.COMPLETED', 'CHECKOUT.ORDER.APPROVED'].includes(eventType);
    return {
      eventId: String(json.id || Date.now()),
      orderNo: String(resource.reference_id || resource.supplementary_data?.related_ids?.order_id || resource.id || ''),
      paid,
      amountCents: Math.round(Number(resource.amount?.value || 0) * 100),
      providerTradeNo: resource.id || null,
    };
  }

  async queryOrder(orderNo: string, config: ChannelConfig) {
    const c = this.cfg(config);
    const accessToken = await this.token(c);
    const resp = await this.req('GET', `/v2/checkout/orders/${encodeURIComponent(orderNo)}`, base(c.environment) + `/v2/checkout/orders/${encodeURIComponent(orderNo)}`, undefined, accessToken);
    const status = String(resp.status || '');
    const paid = status === 'COMPLETED';
    return { paid, tradeStatus: status, providerTradeNo: resp.id || null };
  }

  async testConnection(config: ChannelConfig) {
    const c = this.cfg(config);
    const items = [
      { name: 'Client ID', status: !!c.clientId, message: c.clientId ? '已填写' : '缺少 Client ID' },
      { name: 'Client Secret', status: !!c.clientSecret, message: c.clientSecret ? '已填写' : '缺少 Client Secret' },
    ];
    try {
      await this.token(c);
      items.push({ name: '认证连通性', status: true, message: '已获取 access token' });
    } catch (e: any) {
      items.push({ name: '认证连通性', status: false, message: `认证失败：${e.message}` });
    }
    const success = items.every(i => i.status);
    return { success, message: success ? 'PayPal 配置检查通过' : 'PayPal 配置缺失或认证失败', items };
  }
}
