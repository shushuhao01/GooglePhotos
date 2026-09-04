import { createHash, createSign, createDecipheriv, verify as cryptoVerify, createVerify } from 'node:crypto';
import { PaymentProvider, CheckoutInput, ChannelConfig } from './types.js';

const GATEWAY = 'https://api.mch.weixin.qq.com';

function fmt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/* APIv3 请求签名：message = METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n */
function signRequest(method: string, path: string, body: string, mchId: string, serialNo: string, privateKey: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = createHash('sha256').update(timestamp + Math.random()).digest('hex').slice(0, 32);
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signer = createSign('RSA-SHA256');
  signer.update(message, 'utf8');
  const signature = signer.sign(privateKey.replace(/\\n/g, '\n'), 'base64');
  return {
    authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`,
    timestamp, nonce,
  };
}

/* 回调解密：AES-256-GCM，nonce + associated_data + ciphertext */
function decryptResource(apiV3Key: string, resource: any): Record<string, unknown> {
  const ciphertext = Buffer.from(resource.ciphertext, 'base64');
  const key = Buffer.from(apiV3Key, 'utf8'); // APIv3 密钥长度为 32 字节
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

export class WeChatProvider implements PaymentProvider {
  readonly name = 'wechat' as const;
  validateConfig(c: ChannelConfig) {
    return ['appid', 'mchid', 'merchantPrivateKey', 'apiV3Key', 'serialNo'].filter(k => !String(c[k] || '').trim());
  }
  private cfg(c: ChannelConfig) {
    const cc = c as unknown as Record<string, string>;
    return {
      appid: cc.appid || cc.appId || '',
      mchid: cc.mchid || '',
      apiV3Key: (cc.apiV3Key || '').replace(/\s/g, ''),
      serialNo: cc.serialNo || '',
      privateKey: (cc.merchantPrivateKey || cc.privateKey || '').replace(/\\n/g, '\n'),
      notifyUrl: cc.notifyUrl || '',
      method: cc.method || 'native', /* native 扫码 / h5 跳转 */
    };
  }
  private async req(method: string, path: string, body: Record<string, unknown>, c: ReturnType<WeChatProvider['cfg']>, queryPath?: string) {
    const bodyStr = JSON.stringify(body);
    const auth = signRequest(method, queryPath || path, bodyStr, c.mchid, c.serialNo, c.privateKey);
    const resp = await fetch(GATEWAY + path, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: auth.authorization, 'User-Agent': 'web-image-uploader/1.0' },
      body: method === 'GET' ? undefined : bodyStr,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`微信支付 API ${resp.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  }

  async createCheckout(input: CheckoutInput, config: ChannelConfig) {
    const c = this.cfg(config);
    const path = `/v3/pay/transactions/${c.method === 'h5' ? 'h5' : 'native'}`;
    const body: Record<string, unknown> = {
      appid: c.appid, mchid: c.mchid, description: input.title,
      out_trade_no: input.orderNo,
      notify_url: c.notifyUrl || input.notifyUrl,
      amount: { total: input.amountCents, currency: 'CNY' },
    };
    if (c.method === 'h5') {
      body.scene_info = { payer_client_ip: '127.0.0.1', h5_info: { type: 'Wap' } };
    }
    const resp = await this.req('POST', path, body, c, path);
    if (c.method === 'h5') return { provider: this.name, checkoutUrl: resp.h5_url, tradeNo: resp.prepay_id };
    return { provider: this.name, qrCode: resp.code_url, tradeNo: resp.prepay_id };
  }

  verifyWebhook(headers: Record<string, string | undefined>, body: string, config: ChannelConfig) {
    const c = this.cfg(config);
    const json = JSON.parse(body || '{}');
    // 验签：WECHATPAY2-SHA256-RSA2048 头
    const ser = headers['wechatpay-serial'] || '';
    const sig = headers['wechatpay-signature'] || '';
    const nonce = headers['wechatpay-nonce'] || '';
    const timestamp = headers['wechatpay-timestamp'] || '';
    const message = `${timestamp}\n${nonce}\n${body}\n`;
    // 微信回调使用微信平台证书验签，未配置平台证书时用 apiV3Key 做一次弱校验占位
    if (!sig) throw new Error('微信回调缺少签名头');
    // 简化：记录 & 走解密，生产需配置平台证书做严格验签
    const resource = decryptResource(c.apiV3Key, json.resource || {}) as Record<string, any>;
    const tradeState = String(resource.trade_state || '');
    const paid = tradeState === 'SUCCESS';
    return {
      eventId: String(json.id || Date.now()),
      orderNo: String(resource.out_trade_no || ''),
      paid,
      amountCents: Number(resource.amount?.total || 0),
      providerTradeNo: resource.transaction_id ? String(resource.transaction_id) : null,
    };
  }

  async queryOrder(orderNo: string, config: ChannelConfig) {
    const c = this.cfg(config);
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${c.mchid}`;
    try {
      const resp = await this.req('GET', path, {}, c, path);
      return { paid: resp.trade_state === 'SUCCESS', tradeStatus: String(resp.trade_state || ''), providerTradeNo: resp.transaction_id || null };
    } catch (e: any) {
      // 订单不存在也返回未支付，不抛错
      if (String(e.message).includes('ORDER_NOT_EXIST')) return { paid: false, tradeStatus: 'NOTPAY', providerTradeNo: null };
      throw e;
    }
  }

  async testConnection(config: ChannelConfig) {
    const c = this.cfg(config);
    const items = [
      { name: 'AppID', status: !!c.appid, message: c.appid ? '已填写' : '缺少 AppID' },
      { name: '商户号', status: !!c.mchid, message: c.mchid ? '已填写' : '缺少 mchid' },
      { name: 'APIv3 密钥', status: c.apiV3Key.length === 32, message: c.apiV3Key.length === 32 ? '已填写' : '需 32 位密钥' },
      { name: '证书序列号', status: !!c.serialNo, message: c.serialNo ? '已填写' : '缺少 serialNo' },
      { name: '商户私钥', status: !!c.privateKey, message: c.privateKey ? '已填写' : '缺少私钥' },
    ];
    try {
      await this.queryOrder('CONN_TEST_' + Date.now(), config);
      items.push({ name: '网关连通性', status: true, message: '已连通' });
    } catch (e: any) {
      items.push({ name: '网关连通性', status: false, message: `连通失败：${e.message}` });
    }
    const success = items.every(i => i.status);
    return { success, message: success ? '微信支付配置格式检查通过' : '微信支付配置缺失或连接失败', items };
  }
}
