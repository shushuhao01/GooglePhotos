/* PGX content: page-bridge —— Service Worker 与页面之间的图片抓取桥
 * 两级抓取：
 *   1) 隔离世界 fetch（同源/CORS 允许的图片）
 *   2) MAIN world 抓取（通过 CustomEvent 与 main-fetcher.js 通信，
 *      携带页面自然 Referer/Cookie，突破部分防盗链；需先由 SW 注入 main-fetcher.js）
 * 返回 {ok, bytes, contentType} 或 {ok:false, code, message}。 */
(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
  const PGX = (typeof self !== 'undefined' ? self : globalThis).PGX;
  if (!PGX || !PGX.C || !PGX.U) return;
  const C = PGX.C;
  const U = PGX.U;

  function withTimeout(promise, ms) {
    let timer;
    const to = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
    return Promise.race([promise, to]).finally(() => clearTimeout(timer));
  }

  /** 方式一：隔离世界 fetch */
  async function isolatedFetch(url, timeoutSec) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (timeoutSec || C.TASK.DEFAULT_TIMEOUT_SEC) * 1000);
    try {
      const res = await fetch(url, { credentials: 'include', redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, code: C.ERR.HTTP, status: res.status, message: `HTTP ${res.status}` };
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const buf = await res.arrayBuffer();
      return { ok: true, bytes: buf, contentType, status: res.status };
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') return { ok: false, code: C.ERR.TIMEOUT, message: '下载超时' };
      const msg = String((e && e.message) || e);
      if (/cors|failed to fetch|networkerror/i.test(msg)) return { ok: false, code: C.ERR.CORS, message: '跨域限制' };
      return { ok: false, code: C.ERR.NETWORK, message: msg };
    }
  }

  /* ---------- MAIN world 桥 ---------- */

  let mainFetchSeq = 0;
  const pendingMain = new Map();

  function onMainResult(ev) {
    const d = ev.detail;
    if (!d || !d.id) return;
    const h = pendingMain.get(d.id);
    if (!h) return;
    if (d.error) {
      pendingMain.delete(d.id);
      clearTimeout(h.timer);
      h.reject(Object.assign(new Error(d.error), { code: d.code || C.ERR.CORS }));
      return;
    }
    if (typeof d.chunk === 'string' && d.chunk) {
      try { h.parts.push(U.base64ToBytes(d.chunk)); } catch (e) { /* 丢弃坏块 */ }
    }
    if (d.done) {
      pendingMain.delete(d.id);
      clearTimeout(h.timer);
      const total = h.parts.reduce((s, p) => s + p.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const p of h.parts) { merged.set(p, off); off += p.length; }
      h.resolve({ ok: true, bytes: merged.buffer, contentType: d.contentType || '', status: 200 });
    }
  }
  window.addEventListener('pgx-bridge-fetch-result', onMainResult);

  /** 方式二：向 MAIN world 派发抓取任务并聚合分块结果 */
  function mainWorldFetch(url, timeoutSec) {
    return new Promise((resolve, reject) => {
      const id = 'm' + Date.now().toString(36) + (mainFetchSeq++);
      const parts = [];
      const timer = setTimeout(() => {
        if (pendingMain.delete(id)) reject(Object.assign(new Error('timeout'), { code: C.ERR.TIMEOUT }));
      }, (timeoutSec || 30) * 1000 + 5000);
      pendingMain.set(id, { parts, timer, resolve, reject });
      window.dispatchEvent(new CustomEvent('pgx-bridge-request', { detail: { id, url } }));
    });
  }

  /* ---------- 消息入口 ---------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type === C.MSG.DOWNLOAD_IMAGE) {
      (async () => {
        // 先隔离世界抓取；失败降级 MAIN world
        const r1 = await isolatedFetch(msg.url, msg.timeoutSec);
        if (r1.ok) return r1;
        try {
          return await mainWorldFetch(msg.url, msg.timeoutSec);
        } catch (e) {
          const code = e && e.code;
          return { ok: false, code: code || r1.code, message: (e && e.message) || r1.message };
        }
      })().then((r) => sendResponse(r));
      return true; // 异步
    }
    if (msg.type === C.MSG.FETCH_MAIN) {
      mainWorldFetch(msg.url, msg.timeoutSec).then((r) => sendResponse(r)).catch((e) =>
        sendResponse({ ok: false, code: (e && e.code) || C.ERR.NETWORK, message: (e && e.message) || '' }));
      return true;
    }
    return false;
  });
})();
