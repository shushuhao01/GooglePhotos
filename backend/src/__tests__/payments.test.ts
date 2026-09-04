import test from 'node:test';
import assert from 'node:assert';
import { providerFor } from '../payments/index.js';

test('mock provider validates & creates checkout', async () => {
  const p = providerFor('mock');
  assert.deepEqual(p.validateConfig({}), []);
  const res = await p.createCheckout({ orderNo: 'X1', amountCents: 100, title: 't', notifyUrl: '' }, {});
  assert.equal(res.provider, 'mock');
});

test('alipay validateConfig detects missing fields', async () => {
  const p = providerFor('alipay');
  const missing = p.validateConfig({ appId: 'x' });
  assert.ok(missing.includes('privateKey'));
  assert.ok(missing.includes('alipayPublicKey'));
});

test('wechat validateConfig requires 32-byte apiV3Key', async () => {
  const p = providerFor('wechat');
  const missing = p.validateConfig({ appid: 'a', mchid: 'm' });
  assert.ok(missing.includes('apiV3Key'));
  assert.ok(missing.includes('serialNo'));
});

test('paypal validateConfig requires client credentials', async () => {
  const p = providerFor('paypal');
  const missing = p.validateConfig({});
  assert.deepEqual(missing, ['clientId', 'clientSecret']);
});

test('mock webhook parses paid state', () => {
  const p = providerFor('mock');
  const r = p.verifyWebhook({}, JSON.stringify({ orderNo: 'X1', paid: true }), {});
  assert.equal(r.orderNo, 'X1');
  assert.equal(r.paid, true);
});
