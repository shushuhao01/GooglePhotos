/* PGX content: main-fetcher —— 注入页面 MAIN world 的抓取助手
 * 该脚本运行在页面主世界（由 Service Worker 以 chrome.scripting.executeScript({world:'MAIN'}) 注入），
 * 因此自带页面 Cookies 与 Referer，可突破部分防盗链/登录限制。
 * 仅通过 CustomEvent 与隔离世界的 page-bridge 通信（不使用 chrome.* API）。
 * 幂等：重复注入安全。 */
(function () {
  try {
    if (window.__pgxMainFetchReady) return;
    window.__pgxMainFetchReady = true;

    const CHUNK = 1500000; // 每块 base64 字符数（与 shared/constants.js DL.BASE64_CHUNK 一致）

    function bufToB64(buf) {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return btoa(bin);
    }

    function emit(detail) {
      try {
        window.dispatchEvent(new CustomEvent('pgx-bridge-fetch-result', { detail }));
      } catch (e) { /* 页面可能正在销毁 */ }
    }

    async function handleRequest(d) {
      const id = d.id, url = d.url;
      if (!id || !url) return;
      let res;
      try {
        // credentials:'include' 让请求带上页面对该域的 Cookie；模式 cors，Referer 自然为页面地址
        res = await fetch(url, { credentials: 'include', redirect: 'follow', mode: 'cors', cache: 'default' });
      } catch (e) {
        const msg = String((e && e.message) || e);
        emit({ id, error: msg, code: /cors|failed to fetch|networkerror/i.test(msg) ? 'CORS' : 'NETWORK' });
        return;
      }
      if (!res.ok) { emit({ id, error: 'HTTP ' + res.status, code: 'HTTP', status: res.status }); return; }
      try {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        const buf = await res.arrayBuffer();
        const b64 = bufToB64(buf);
        const total = Math.ceil(b64.length / CHUNK);
        for (let i = 0; i < total; i++) {
          const piece = b64.slice(i * CHUNK, (i + 1) * CHUNK);
          emit({ id, chunk: piece, index: i, total, done: false });
          // 让出主线程，避免阻塞页面
          if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
        }
        emit({ id, done: true, total, contentType });
      } catch (e) {
        emit({ id, error: String((e && e.message) || e), code: 'NETWORK' });
      }
    }

    window.addEventListener('pgx-bridge-request', (ev) => {
      const d = ev.detail;
      if (d && d.url) handleRequest(d).catch(() => emit({ id: d.id, error: 'internal', code: 'NETWORK' }));
    });
  } catch (e) {
    /* 注入环境异常时静默失败，上层会有降级路径 */
  }
})();
