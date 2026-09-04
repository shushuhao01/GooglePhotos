/* PGX.Downloader —— 图片字节下载（三级策略 + 统一校验）
 * 1) 标签页 Content Script（隔离世界 fetch，失败降级 MAIN world fetch：带页面 Referer/Cookie）
 * 2) Service Worker 直连（需用户授予 <all_urls> 主机权限，可绕过 CORS）
 * 3) Mock：返回 1x1 PNG，用于无网络联调
 * 返回 {ok, bytes, mime} 或 {ok:false, code, message}。 */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const U = PGX.U;
  const C = PGX.C;

  const MOCK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function sendToTab(tabId, msg, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(Object.assign(new Error('timeout'), { code: C.ERR.TIMEOUT })); } }, timeoutMs || 90000);
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) reject(Object.assign(new Error(err.message || 'no receiver'), { code: 'NO_RECEIVER' }));
        else resolve(resp);
      });
    });
  }

  async function ensureContentScripts(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'src/shared/constants.js', 'src/shared/utils.js', 'src/shared/srcset.js',
        'src/shared/urls.js', 'src/shared/scoring.js', 'src/shared/validators.js',
        'src/content/scanner.js', 'src/content/page-bridge.js'
      ]
    });
  }

  async function ensureMainFetcher(tabId) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['src/content/main-fetcher.js'] });
    } catch (e) { /* 某些页面禁止注入时静默 */ }
  }

  function validateBytes(bytes, contentType, url, opts) {
    if (!bytes || bytes.byteLength === 0) return { code: C.ERR.EMPTY, message: C.ERROR_TEXT[C.ERR.EMPTY] };
    const limit = (opts.fileLimitMB || C.TASK.DEFAULT_FILE_LIMIT_MB) * 1024 * 1024;
    if (bytes.byteLength > limit) return { code: C.ERR.FILE_TOO_LARGE, message: C.ERROR_TEXT[C.ERR.FILE_TOO_LARGE] };
    const mime = U.sniffImageMime(bytes, contentType || '');
    if (!mime) return { code: C.ERR.NOT_IMAGE, message: C.ERROR_TEXT[C.ERR.NOT_IMAGE] };
    return { ok: true, mime };
  }

  async function swFetch(url, opts) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), (opts.timeoutSec || 30) * 1000);
    try {
      const req = { credentials: 'include', redirect: 'follow', signal: ctl.signal };
      if (opts.referrer) { req.referrer = opts.referrer; req.referrerPolicy = 'strict-origin-when-cross-origin'; }
      const res = await fetch(url, req);
      clearTimeout(timer);
      if (!res.ok) return { ok: false, code: C.ERR.HTTP, status: res.status, message: `HTTP ${res.status}` };
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const buf = await res.arrayBuffer();
      const v = validateBytes(buf, contentType, url, opts);
      if (!v.ok) return v;
      return { ok: true, bytes: buf, mime: v.mime };
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') return { ok: false, code: C.ERR.TIMEOUT, message: C.ERROR_TEXT[C.ERR.TIMEOUT] };
      return { ok: false, code: C.ERR.NETWORK, message: String((e && e.message) || e) };
    }
  }

  const Downloader = {
    async hasHostPermission(url) {
      try {
        return await chrome.permissions.contains({ origins: [new URL(url).origin + '/*'] });
      } catch (e) { return false; }
    },

    /**
     * 主入口
     * @param {string} url 图片地址
     * @param {number} tabId 来源标签页
     * @param opts {timeoutSec, fileLimitMB}
     */
    async download(url, tabId, opts) {
      opts = opts || {};
      const settings = await PGX.Store.getSettings();
      if (settings.auth && settings.auth.useMock) {
        const bytes = U.base64ToBytes(MOCK_PNG_B64).buffer;
        return { ok: true, bytes, mime: 'image/png' };
      }
      const limitMb = opts.fileLimitMB || settings.singleFileLimitMB || C.TASK.DEFAULT_FILE_LIMIT_MB;

      const hasPerm = url ? await Downloader.hasHostPermission(url) : false;

      // 路径 B（有主机权限）：Service Worker 直连 —— 绕过 CORS、速度快，优先尝试。
      // 注意：content script 与 MAIN world 的 fetch 都受 CORS 限制，无法破解防盗链；只有扩展后台直连可以。
      if (hasPerm) {
        const r = await swFetch(url, { timeoutSec: opts.timeoutSec || 30, fileLimitMB: limitMb, referrer: opts.referrer || '' });
        if (r.ok) return { ok: true, bytes: r.bytes, mime: r.mime, via: 'sw' };
        // 站点常用 401/403 拒绝扩展后台直连，但页面本身已带登录 Cookie/Referer；
        // 这类响应必须继续走 content/main world，而不是直接当成 Google 授权失效。
        if (r.status !== 401 && r.status !== 403 && r.code !== C.ERR.CORS && r.code !== C.ERR.NETWORK) return r;
        // CORS/网络失败 -> 尝试页面上下文抓取
      }

      // 路径 A：Content Script（若存在；隔离 fetch，失败降级 MAIN world）
      if (tabId) {
        try {
          await ensureContentScripts(tabId).catch(() => null);
          const resp = await sendToTab(tabId, {
            type: C.MSG.DOWNLOAD_IMAGE, url, timeoutSec: opts.timeoutSec || settings.timeoutSec || 30
          }, 100000);
          if (resp && resp.ok && resp.bytes) {
            const v = validateBytes(resp.bytes, resp.contentType || '', url, { fileLimitMB: limitMb });
            if (v.ok) return { ok: true, bytes: resp.bytes, mime: v.mime, via: 'content' };
            if (v.code === C.ERR.NOT_IMAGE) return v; // 内容确实是错的，不再降级
          }
        } catch (e) { /* 无 content script 或页面不可达 -> 降级 */ }
      }

      // 路径 C：MAIN world 抓取（需要 content script 存在；带页面 Cookie/Referer，但受 CORS 限制）
      if (tabId) {
        try {
          await ensureMainFetcher(tabId).catch(() => null);
          const resp = await sendToTab(tabId, {
            type: C.MSG.FETCH_MAIN, url, timeoutSec: opts.timeoutSec || settings.timeoutSec || 30
          }, 120000);
          if (resp && resp.ok && resp.bytes) {
            const v = validateBytes(resp.bytes, resp.contentType || '', url, { fileLimitMB: limitMb });
            if (v.ok) return { ok: true, bytes: resp.bytes, mime: v.mime, via: 'main' };
            if (v.code === C.ERR.NOT_IMAGE) return v;
          }
          if (resp && !resp.ok) return { ok: false, code: resp.code || C.ERR.NETWORK, status: resp.status || 0, message: resp.message || C.ERROR_TEXT[C.ERR.NETWORK] };
        } catch (e) { /* 降级结束 */ }
      }

      // 有权限仍失败的（如登录墙/真实 404）：给出更贴合的提示
      if (hasPerm) return { ok: false, code: C.ERR.NETWORK, message: '已授权仍无法读取（可能为登录墙/付费墙或地址已失效）' };
      return { ok: false, code: C.ERR.CORS, message: '跨域（防盗链）限制：请授予「所有网站」下载权限后重试' };
    }
  };

  PGX.Downloader = Downloader;
})();
