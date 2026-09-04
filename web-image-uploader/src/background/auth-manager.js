/* PGX.Auth —— Google OAuth 认证管理
 * 双适配器：
 *   webauth      ：chrome.identity.launchWebAuthFlow + PKCE + refresh token（默认，可选任意 Google 账号）
 *   chromeidentity：chrome.identity.getAuthToken（跟随浏览器登录账号，Chrome 自动续期）
 * Mock 模式：settings.auth.useMock = true 时返回假 token，便于无凭据联调全链路。 */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const Store = PGX.Store;
  const U = PGX.U;
  const C = PGX.C;

  const A = {};
  const listeners = { change: [], required: [] };

  A.on = (evt, fn) => { if (listeners[evt]) listeners[evt].push(fn); return () => { listeners[evt] = listeners[evt].filter((f) => f !== fn); }; };
  async function emit(evt, payload) {
    for (const fn of listeners[evt]) { try { await fn(payload); } catch (e) { /* noop */ } }
  }

  /* ---------- 基础 ---------- */

  function decodeIdToken(idToken) {
    try {
      const p = idToken.split('.')[1];
      const json = decodeURIComponent(escape(atob(p.replace(/-/g, '+').replace(/_/g, '/'))));
      return JSON.parse(json);
    } catch (e) { return {}; }
  }

  function base64UrlEncode(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function sha256(str) {
    const data = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(digest);
  }

  function randomString(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    let s = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    for (const b of arr) s += chars[b % chars.length];
    return s;
  }

  function tokenExpired(auth) {
    if (!auth || !auth.accessToken) return true;
    if (!auth.expiresAt) return false; // chromeidentity 无过期信息，交给调用方处理 401
    return Date.now() + C.AUTH.MIN_EXPIRY_MS >= auth.expiresAt;
  }

  function maskEmail(email) {
    if (!email) return '';
    const [name, dom] = email.split('@');
    if (!dom) return email;
    return (name.slice(0, 2) + '****@' + dom);
  }

  /* ---------- POST token 交换 ---------- */

  async function tokenRequest(body) {
    const res = await fetch(C.AUTH.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error_description || data.error || ('token HTTP ' + res.status));
      err.code = data.error === 'invalid_grant' ? C.ERR.AUTH_EXPIRED : C.ERR.AUTH_DENIED;
      throw err;
    }
    return data;
  }

  async function userInfo(accessToken) {
    const res = await fetch(C.AUTH.USERINFO_URL, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && data.email ? { email: data.email, name: data.name || '', picture: data.picture || '' } : null;
  }

  /* ---------- webauth 适配器 ---------- */

  async function webauthLogin(settings) {
    const manifestClientId = (chrome.runtime.getManifest && chrome.runtime.getManifest().oauth2 && chrome.runtime.getManifest().oauth2.client_id) || '';
    const clientId = (settings.auth && settings.auth.clientId) || manifestClientId;
    if (!clientId) {
      const err = new Error('未配置 OAuth Client ID');
      err.code = 'NO_CLIENT_ID';
      throw err;
    }
    if (!chrome.identity || !chrome.identity.launchWebAuthFlow) {
      const err = new Error('当前浏览器不支持 launchWebAuthFlow');
      err.code = C.ERR.AUTH_DENIED;
      throw err;
    }
    const redirectUri = 'https://' + chrome.runtime.id + '.chromiumapp.org/'; // host 级，与 Google Chrome 扩展程序类型客户端自动注册地址一致（勿加 /oauth2）
    const verifier = randomString(64);
    const challenge = await sha256(verifier);
    const scope = C.AUTH.SCOPES.join(' ');

    const authzUrl = new URL(C.AUTH.AUTHZ_URL);
    authzUrl.searchParams.set('client_id', clientId);
    authzUrl.searchParams.set('redirect_uri', redirectUri);
    authzUrl.searchParams.set('response_type', 'code');
    authzUrl.searchParams.set('scope', scope);
    authzUrl.searchParams.set('access_type', 'offline');
    authzUrl.searchParams.set('prompt', 'consent');
    authzUrl.searchParams.set('code_challenge', challenge);
    authzUrl.searchParams.set('code_challenge_method', 'S256');
    authzUrl.searchParams.set('state', randomString(16));

    const retUrl = await chrome.identity.launchWebAuthFlow({ url: authzUrl.toString(), interactive: true });
    if (!retUrl) { const e = new Error('授权被取消'); e.code = C.ERR.AUTH_DENIED; throw e; }
    const ret = new URL(retUrl);
    const code = ret.searchParams.get('code');
    const state = ret.searchParams.get('state');
    if (!code) {
      const e = new Error(ret.searchParams.get('error') || '授权失败');
      e.code = ret.searchParams.get('error') === 'access_denied' ? C.ERR.AUTH_DENIED : C.ERR.AUTH_EXPIRED;
      throw e;
    }

    const tokens = await tokenRequest({
      code, client_id: clientId, code_verifier: verifier,
      redirect_uri: redirectUri, grant_type: 'authorization_code'
    });
    const account = decodeIdToken(tokens.id_token || '');
    const auth = {
      method: 'webauth', clientId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      account: account.email ? { email: account.email, name: account.name || '', picture: account.picture || '' } : null
    };
    if (!auth.account) auth.account = await userInfo(tokens.access_token);
    if (!auth.account) {
      const e = new Error('Google 授权令牌无效，请重新登录');
      e.code = C.ERR.AUTH_EXPIRED;
      throw e;
    }
    await Store.saveAuth(auth);
    return auth;
  }

  async function webauthRefresh(auth) {
    if (!auth.refreshToken) {
      const e = new Error('缺少 refresh token');
      e.code = C.ERR.AUTH_EXPIRED;
      throw e;
    }
    const tokens = await tokenRequest({
      refresh_token: auth.refreshToken, client_id: auth.clientId,
      grant_type: 'refresh_token'
    });
    const next = Object.assign({}, auth, {
      accessToken: tokens.access_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null
    });
    await Store.saveAuth(next);
    return next;
  }

  /* ---------- chromeidentity 适配器 ---------- */

  async function chromeIdentityLogin(interactive = true) {
    if (!chrome.identity || !chrome.identity.getAuthToken) {
      const e = new Error('当前浏览器不支持 chrome.identity');
      e.code = C.ERR.AUTH_DENIED;
      throw e;
    }
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: !!interactive }, (tok) => {
        const err = chrome.runtime.lastError;
        if (err) { const e = new Error(err.message || 'getAuthToken 失败'); e.code = C.ERR.AUTH_DENIED; reject(e); }
        else resolve(tok);
      });
    });
    const account = await userInfo(token);
    // getAuthToken 可能返回浏览器缓存中的已撤销 token；不能把它当成“登录成功”保存，
    // 否则界面显示已登录、首次 Photos 请求却直接 401。
    if (!account) {
      try { await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, () => resolve())); } catch (e) { /* noop */ }
      const e = new Error('Google 授权令牌无效或已撤销，请重新登录');
      e.code = C.ERR.AUTH_EXPIRED;
      throw e;
    }
    const auth = {
      method: 'chromeidentity', clientId: '',
      accessToken: token, refreshToken: null, expiresAt: null,
      account
    };
    await Store.saveAuth(auth);
    return auth;
  }

  /* ---------- 统一 API ---------- */

  async function getClientConfig() {
    const settings = await Store.getSettings();
    return settings;
  }

  /** 获取有效 access token；必要时刷新；全部失败抛 AUTH_EXPIRED */
  async function ensureToken(interactive, forceRefresh) {
    const settings = await getClientConfig();
    if (settings.auth && settings.auth.useMock) return 'mock-access-token';

    let auth = await Store.getAuth();
    const method = (auth && auth.method) || settings.auth.method || 'webauth';

    // chrome.identity 返回的 token 通常没有 expiresAt，遇到 401 时必须显式移除
    // 缓存 token，否则后续重试会一直复用失效凭据。
    if (forceRefresh && auth && auth.method === 'chromeidentity' && auth.accessToken) {
      try { await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token: auth.accessToken }, () => resolve())); } catch (e) { /* noop */ }
      // 保留账号信息与授权方式，只清除短期 access token；下方会重新获取。
      auth = Object.assign({}, auth, { accessToken: null, expiresAt: null });
      await Store.saveAuth(auth);
    }
    if (auth && auth.method === 'chromeidentity' && !tokenExpired(auth)) return auth.accessToken;

    const needsInteractiveLogin = !auth || method !== auth.method || (tokenExpired(auth) && method === 'chromeidentity') || (tokenExpired(auth) && method === 'webauth' && !auth.refreshToken);
    if (needsInteractiveLogin) {
      if (!interactive && !auth) {
        const e = new Error('未授权');
        e.code = C.ERR.AUTH_EXPIRED;
        throw e;
      }
      auth = await (method === 'chromeidentity' ? chromeIdentityLogin() : webauthLogin(settings));
      emit('change', { auth });
      return auth.accessToken;
    }

    // webauth：尝试静默刷新
    try {
      const refreshed = await webauthRefresh(auth);
      emit('change', { auth: refreshed });
      return refreshed.accessToken;
    } catch (e) {
      if (!interactive) throw e;
      // refresh 失败 -> 重走登录
      const fresh = await webauthLogin(settings);
      emit('change', { auth: fresh });
      return fresh.accessToken;
    }
  }

  /** 处理业务中遇到的 401：清除缓存 token 并提示重新授权 */
  async function handleUnauthorized(reason) {
    // 不要因一次 401 把持久登录态删除；保留 refresh token/账号信息，下一次请求自动续期。
    const auth = await Store.getAuth();
    if (auth) {
      await Store.saveAuth(Object.assign({}, auth, { accessToken: null, expiresAt: null }));
    }
    emit('required', { reason: reason || 'token_invalid' });
  }

  async function getState() {
    const settings = await getClientConfig();
    const auth = await Store.getAuth();
    const manifestClientId = (chrome.runtime.getManifest && chrome.runtime.getManifest().oauth2 && chrome.runtime.getManifest().oauth2.client_id) || '';
    return {
      connected: !!(auth && (auth.accessToken || auth.refreshToken || auth.account)),
      account: auth ? auth.account : null,
      method: auth ? auth.method : (settings.auth.method || 'webauth'),
      useMock: !!(settings.auth && settings.auth.useMock),
      clientConfigured: !!((settings.auth && settings.auth.clientId) || manifestClientId),
      maskEmail: auth && auth.account ? maskEmail(auth.account.email) : ''
    };
  }

  async function login() {
    const settings = await getClientConfig();
    if (settings.auth && settings.auth.useMock) {
      const mockAuth = { method: 'mock', accessToken: 'mock-access-token', refreshToken: null, expiresAt: null, account: { email: 'mock@local.test', name: 'Mock 账号', picture: '' } };
      await Store.saveAuth(mockAuth);
      emit('change', { auth: mockAuth });
      return mockAuth;
    }
    const method = settings.auth.method || 'webauth';
    const auth = method === 'chromeidentity' ? await chromeIdentityLogin() : await webauthLogin(settings);
    emit('change', { auth });
    return auth;
  }

  async function logout(revokeToken) {
    const auth = await Store.getAuth();
    if (auth && auth.accessToken) {
      try {
        if (auth.method === 'chromeidentity') {
          await new Promise((res) => chrome.identity.removeCachedAuthToken({ token: auth.accessToken }, () => res()));
        } else if (revokeToken) {
          await fetch(C.AUTH.REVOKE_URL + '?token=' + encodeURIComponent(auth.accessToken), { method: 'POST' }).catch(() => null);
        }
      } catch (e) { /* noop */ }
    }
    await Store.saveAuth(null);
    emit('change', { auth: null });
  }

  A.ensureToken = ensureToken;
  A.handleUnauthorized = handleUnauthorized;
  A.getState = getState;
  A.login = login;
  A.logout = logout;
  A.decodeIdToken = decodeIdToken;

  PGX.Auth = A;
})();
