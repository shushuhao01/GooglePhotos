/* PGX.Billing —— 收费后端 API 客户端
 * 负责与后端(web-image-uploader 收费服务)交互：登录、套餐、权益状态、预扣/确认/退回、
 * 下单、订单查询。仅 Service Worker 引用；纯 fetch 实现，无 DOM 依赖，可单测。 */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const Store = PGX.Store;
  const U = PGX.U;

  const B = {};

  /* 后端地址（无 schema 默认 https） */
  function apiBase() {
    const settings = B._settings || {};
    let base = (settings.billing && settings.billing.baseUrl) || '';
    base = (base || '').trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
    return base;
  }

  function isConfigured() {
    return !!apiBase();
  }

  /* 统一请求封装：返回 {ok, code, message, ...data} */
  async function req(method, path, body, headers) {
    const base = apiBase();
    if (!base) throw Object.assign(new Error('请先填写收费后端地址'), { code: 'BILLING_NOT_CONFIGURED' });
    const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
    const token = await B.getToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    const resp = await fetch(base + '/api/v1' + path, {
      method, headers: h,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = {};
    try { data = await resp.json(); } catch (e) { data = {}; }
    if (!resp.ok) {
      const err = Object.assign(new Error(data.message || ('后端请求失败 ' + resp.status)), {
        code: data.code || 'HTTP_' + resp.status, status: resp.status, details: data.details
      });
      throw err;
    }
    return data;
  }
  const get = (path, h) => req('GET', path, undefined, h);
  const post = (path, body, h) => req('POST', path, body, h);

  /* ---------- 登录令牌（本地存储，product 账号） ---------- */
  async function getToken() {
    const auth = await Store.load('billing_auth', null).catch(() => null);
    return (auth && auth.token) || '';
  }
  async function setAuth(auth) {
    if (auth === null) { await Store.save('billing_auth', null); return; }
    await Store.save('billing_auth', auth);
  }
  async function getAuth() {
    return await Store.load('billing_auth', null);
  }

  /* ---------- 登录 ---------- */
  /* 模式：
   *   dev   : 后端 NODE_ENV!=production 时可用，按邮箱免密登录（联调用）
   *   creds : 邮箱 + 密码 login/register
   * 成功后保存 { token, user } 到本地。 */
  async function login({ mode, email, password, register }) {
    const base = apiBase();
    if (!base) throw Object.assign(new Error('请先填写收费后端地址'), { code: 'BILLING_NOT_CONFIGURED' });
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('邮箱格式不正确'), { code: 'INVALID_EMAIL' });
    let path = '/auth/dev-login', body = { email };
    if (mode === 'creds') path = register ? '/auth/register' : '/auth/login';
    if (mode === 'creds') {
      if (!password || password.length < 6) throw Object.assign(new Error('密码至少 6 位'), { code: 'WEAK_PASSWORD' });
      body = { email, password, displayName: register ? '' : undefined };
    }
    const data = await post(path, body);
    if (!data.ok) throw Object.assign(new Error(data.message || '登录失败'), { code: data.code || 'LOGIN_FAILED' });
    // dev-login / login / register 均返回 { token, user }
    const token = data.token, user = data.user;
    if (!token) throw Object.assign(new Error('登录响应缺少 token'), { code: 'LOGIN_FAILED' });
    await setAuth({ token, user, mode, email, ts: Date.now() });
    return { token, user };
  }
  async function logout() {
    await setAuth(null);
    return { ok: true };
  }

  /* ---------- 权益多语言错误 ---------- */
  function quotaMessage(err) {
    if (err && err.code === 'QUOTA_EXCEEDED') return '本月上传额度已用尽，请升级或购买增量次数包';
    if (err && err.code === 'BILLING_NOT_CONFIGURED') return '未配置收费后端，上传配额校验已跳过';
    return (err && err.message) || '权益校验失败';
  }

  /* ---------- 查询权益 ---------- */
  async function status() {
    const data = await get('/entitlements/status');
    return data.entitlement || data.entitlement;
  }

  /* ---------- 预扣 / 确认 / 退回 ----------
   * precheck 流程：start upload 前调用 reserve(operation='upload')，拿到 reservation；
   * 任务结束后 commit 确认（不返额）；任务取消/失败则 release 退回。 */
  async function reserve(operation) {
    const data = await post('/entitlements/reserve', { operation });
    return data; // { ok, reservation, operation, period }
  }
  async function commit(operation, reservation) {
    const data = await post('/entitlements/commit', { operation, reservation });
    return data;
  }
  async function release(operation, reservation) {
    const data = await post('/entitlements/release', { operation, reservation });
    return data;
  }

  /* ---------- 下单（升级/购买） ---------- */
  /* provider: mock|alipay|wechat|paypal；返回 { orderNo, amountCents, checkout } */
  async function checkout(planCode, provider, idempotencyKey) {
    const data = await post('/billing/checkout', {
      planCode, provider: provider || 'mock',
      idempotencyKey: idempotencyKey || undefined
    });
    return data;
  }
  async function mockPay(orderNo) {
    const data = await post('/billing/mock-pay/' + orderNo);
    return data;
  }
  async function orders() {
    const data = await get('/billing/orders');
    return data.orders || [];
  }
  async function plans() {
    const data = await get('/plans');
    return data.plans || [];
  }

  /* 校验后端连通性：发起一个匿名可访问的请求（plans 无需鉴权） */
  async function testConnection(baseUrl) {
    const saved = B._settings;
    try {
      // 用传入的 baseUrl 临时覆盖
      if (baseUrl) B._settings = Object.assign({}, saved || {}, { billing: Object.assign({}, (saved && saved.billing) || {}, { baseUrl }) });
      const data = await get('/plans');
      return { ok: true, reachable: !!data.plans, plans: (data.plans || []).length, cost: 'ok' };
    } catch (e) {
      return { ok: false, reachable: false, error: (e && e.message) || '连接失败' };
    } finally {
      B._settings = saved;
    }
  }

  /* 注入运行时设置缓存（SW 在初始化时调用） */
  function setSettings(settings) {
    B._settings = settings || {};
  }

  B.apiBase = apiBase;
  B.isConfigured = isConfigured;
  B.getToken = getToken;
  B.getAuth = getAuth;
  B.setAuth = setAuth;
  B.login = login;
  B.logout = logout;
  B.status = status;
  B.reserve = reserve;
  B.commit = commit;
  B.release = release;
  B.checkout = checkout;
  B.mockPay = mockPay;
  B.orders = orders;
  B.plans = plans;
  B.testConnection = testConnection;
  B.setSettings = setSettings;
  B.quotaMessage = quotaMessage;

  PGX.Billing = B;
})();
