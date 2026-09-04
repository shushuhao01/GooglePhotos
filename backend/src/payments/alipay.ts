import { createHash, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { PaymentProvider, CheckoutInput, ChannelConfig } from './types.js';
import { logger } from '../config/logger.js';

const GATEWAY = 'https://openapi.alipay.com/gateway.do';

/* 支付宝 RSA2 签名：对公共参数 + biz_content 按 key 排序拼接，用商户私钥签名 */
function sign(params: Record<string, string>, privateKey: string): string {
  const content = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const signer = createSign('RSA-SHA256');
  signer.update(content, 'utf8');
  return signer.sign(privateKey, 'base64');
}

/* 支付宝异步通知验签 */
function verifySign(content: string, signStr: string | undefined, alipayPublicKey: string): boolean {
  if (!signStr) return false;
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(content, 'utf8');
    return verifier.verify(alipayPublicKey, signStr, 'base64');
  } catch {
    return false;
  }
}

function buildParams(config: Record<string, string>, method: string, bizContent: Record<string, string | number> | string) {
  const p: Record<string, string> = {
    app_id: config.appId,
    method,
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().replace(/\.\d{3}Z/, ''),
    version: '1.0',
    notify_url: config.notifyUrl || '',
    biz_content: typeof bizContent === 'string' ? bizContent : JSON.stringify(bizContent),
  };
  p.sign = sign(p, config.privateKey);
  return p;
}

/* form 提交（用 Node 20+ 内置 fetch） */
async function postForm(url: string, params: Record<string, string>): Promise<string> {
  const body = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const resp = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  return resp.text();
}

function safeDecode(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}

export class AlipayProvider implements PaymentProvider {
  readonly name = 'alipay' as const;
  validateConfig(c: ChannelConfig) {
    return ['appId', 'privateKey', 'alipayPublicKey'].filter(k => !String(c[k] || '').trim());
  }
  private cfg(c: ChannelConfig) {
    const cc = c as unknown as Record<string, string>;
    return {
      appId: cc.appId || '',
      privateKey: (cc.privateKey || '').replace(/\\n/g, '\n'),
      alipayPublicKey: (cc.alipayPublicKey || '').replace(/\\n/g, '\n'),
      notifyUrl: cc.notifyUrl || '',
      signType: cc.signType || 'RSA2',
      payMethod: cc.payMethod || 'precreate', /* precreate 当面付扫码 / wap 手机网站 */
    };
  }

  async createCheckout(input: CheckoutInput, config: ChannelConfig) {
    const c = this.cfg(config);
    const bizContent: Record<string, string> = { out_trade_no: input.orderNo, total_amount: (input.amountCents / 100).toFixed(2), subject: input.title };
    if (c.payMethod === 'wap' || c.payMethod === 'h5') {
      const method = 'alipay.trade.wap.pay';
      bizContent.product_code = 'QUICK_WAP_WAY';
      const params = buildParams(c, method, bizContent);
      const url = `${GATEWAY}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
      return { provider: this.name, checkoutUrl: url };
    }
    // 当面付扫码
    const method = 'alipay.trade.precreate';
    const params = buildParams(c, method, bizContent);
    const resp = await postForm(GATEWAY, params);
    const json = safeDecode(resp);
    const apiResp = (json.alipay_trade_precreate_response || {}) as Record<string, string>;
    if (apiResp.code !== '10000') throw new Error(`支付宝下单失败：${apiResp.sub_msg || apiResp.msg || resp}`);
    return { provider: this.name, qrCode: apiResp.qr_code, tradeNo: apiResp.trade_no };
  }

  verifyWebhook(_headers: Record<string, string | undefined>, body: string, config: ChannelConfig) {
    const c = this.cfg(config);
    // 支付宝异步通知是 form 编码的字符串
    const params = Object.fromEntries(new URLSearchParams(body));
    const { sign, sign_type, ...raw } = params;
    const content = Object.keys(raw).filter(k => k !== 'sign').sort().map(k => `${k}=${raw[k]}`).join('&');
    if (!verifySign(content, sign, c.alipayPublicKey)) throw new Error('支付宝验签失败');
    const tradeStatus = params.trade_status || '';
    const paid = ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(tradeStatus);
    return {
      eventId: String(params.notify_id || params.out_trade_no || Date.now()),
      orderNo: String(params.out_trade_no || ''),
      paid,
      amountCents: Math.round(Number(params.total_amount || 0) * 100),
      providerTradeNo: params.trade_no || null,
    };
  }

  async queryOrder(orderNo: string, config: ChannelConfig) {
    const c = this.cfg(config);
    const bizContent: Record<string, string> = { out_trade_no: orderNo };
    const params = buildParams(c, 'alipay.trade.query', bizContent);
    const resp = await postForm(GATEWAY, params);
    const json = safeDecode(resp);
    const apiResp = (json.alipay_trade_query_response || {}) as Record<string, string>;
    if (apiResp.code !== '10000') return { paid: false, tradeStatus: apiResp.msg || '', providerTradeNo: null };
    return { paid: apiResp.trade_status === 'TRADE_SUCCESS' || apiResp.trade_status === 'TRADE_FINISHED', tradeStatus: apiResp.trade_status || '', providerTradeNo: apiResp.trade_no || null };
  }

  async testConnection(config: ChannelConfig) {
    const c = this.cfg(config);
    const items = [
      { name: 'AppID', status: !!c.appId, message: c.appId ? '已填写' : '缺少 AppID' },
      { name: '应用私钥', status: !!c.privateKey, message: c.privateKey ? '已填写' : '缺少应用私钥' },
      { name: '支付宝公钥', status: !!c.alipayPublicKey, message: c.alipayPublicKey ? '已填写' : '缺少支付宝公钥' },
    ];
    // 用一笔不存在的订单号调用 alipay.trade.query 测试连通性
    try {
      const result = await this.queryOrder('CONN_TEST_' + Date.now(), config);
      items.push({ name: '网关连通性', status: true, message: `已连通（返回 ${result.tradeStatus || '判定成功'}）` });
    } catch (e: any) {
      items.push({ name: '网关连通性', status: false, message: `连通失败：${e.message}` });
    }
    const success = items.every(i => i.status);
    return { success, message: success ? '支付宝配置格式检查通过' : '支付宝配置存在必填字段缺失或连接失败', items };
  }
}

/* 供后台生成 RSA2 密钥对（可选工具） */
export function generateRsa2KeyPair() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}
