import { systemConfigService } from './AdminService.js';

/* 汇率换算：套餐定价统一以「人民币分(CNY cents)」存储。
 * 人民币渠道(支付宝/微信)直接用 price_cents；
 * 外币渠道(PayPal 等)需把人民币换算为目标币种再收款。
 * 汇率可从后台「系统配置 → fx_rates」调整，缺省用下面 DEFAULT_RATES。
 */

/* CNY 兑 1 单位外币所需的人民币金额，例如 1 USD = 7.20 CNY */
export const DEFAULT_RATES: Record<string, number> = {
  CNY: 1,
  USD: 7.2,
  EUR: 7.8,
  GBP: 8.5,
  JPY: 0.048,
  HKD: 0.92,
};

/* 支付渠道对应的收款币种（支付宝/微信=人民币，PayPal=美元） */
export const PROVIDER_CURRENCY: Record<string, string> = {
  mock: 'CNY',
  wechat: 'CNY',
  alipay: 'CNY',
  paypal: 'USD',
};

export class RateService {
  /* 读取汇率配置：后端默认值 + 系统配置覆盖 */
  async getRates(): Promise<Record<string, number>> {
    const cfg = (await systemConfigService.get('fx_rates')) as Record<string, unknown>;
    const rates: Record<string, number> = {};
    for (const [cur, base] of Object.entries(DEFAULT_RATES)) {
      const v = Number(cfg?.[cur]);
      rates[cur] = Number.isFinite(v) && v > 0 ? v : base;
    }
    return rates;
  }

  /* 获取「目标币种」相对人民币的汇率：1 目标币 = rate CNY */
  async rateOf(currency: string): Promise<number> {
    const rates = await this.getRates();
    const cur = String(currency || 'CNY').toUpperCase();
    return rates[cur] ?? rates.CNY ?? 1;
  }

  /* 人民币分 -> 目标币种分（用于向支付平台下单） */
  async toForeignCents(cnyCents: number, targetCurrency: string): Promise<number> {
    const rate = await this.rateOf(targetCurrency);
    const cny = Number(cnyCents) / 100;
    const foreign = cny / rate; /* 例如 19.90 CNY / 7.2 = 2.76 USD */
    return Math.max(0, Math.round(foreign * 100));
  }

  /* 目标币种分 -> 人民币分（用于 webhook 金额核对，转换回人民币比对） */
  async toCnyCents(foreignCents: number, sourceCurrency: string): Promise<number> {
    const rate = await this.rateOf(sourceCurrency);
    const foreign = Number(foreignCents) / 100;
    const cny = foreign * rate; /* 例如 2.76 USD * 7.2 = 19.87 CNY */
    return Math.max(0, Math.round(cny * 100));
  }

  /* 目标币种（用于某支付渠道收款） */
  currencyForProvider(provider: string): string {
    return PROVIDER_CURRENCY[provider] || 'CNY';
  }
}

export const rateService = new RateService();
