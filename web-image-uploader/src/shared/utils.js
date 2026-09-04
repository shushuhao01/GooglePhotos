/* PGX.U —— 通用工具函数（纯函数，Node 可测） */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const C = PGX.C;
  const U = {};

  U.id = function () {
    const t = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    return 'id_' + t.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  };

  U.now = () => new Date().toISOString();

  U.clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  U.sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  /** 指数退避（毫秒）：attempt 从 0 开始 */
  U.backoffMs = function (attempt, base) {
    const b = base || 1500;
    const exp = Math.pow(2, U.clamp(attempt, 0, 6));
    const jitter = 0.5 + Math.random() * 0.5;
    return Math.round(b * exp * jitter);
  };

  U.isValidHttpUrl = function (s) {
    if (typeof s !== 'string') return false;
    if (s.length > C.IMG.MAX_URL_LEN) return false;
    let u;
    try { u = new URL(s); } catch (e) { return false; }
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  };

  /** URL 去重键：去 fragment、小写 host、规范化 query 次序 */
  U.urlKey = function (s) {
    if (!U.isValidHttpUrl(s)) return String(s);
    try {
      const u = new URL(s);
      u.hash = '';
      const params = [...u.searchParams.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      u.search = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      u.pathname = decodeURIComponent(u.pathname);
      return u.href.replace(/\/$/, '');
    } catch (e) { return s; }
  };

  U.domainOf = function (url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  };

  /** 从 URL 或 Content-Type 猜扩展名 */
  U.extFromUrl = function (url) {
    try {
      const u = new URL(url);
      const path = u.pathname.toLowerCase();
      const m = path.match(/\.([a-z0-9]{2,5})$/);
      if (m && C.IMG.ALLOWED_EXT.includes(m[1])) return m[1];
    } catch (e) { /* noop */ }
    return '';
  };

  U.mimeFromExt = function (ext) {
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic',
      heif: 'image/heif', bmp: 'image/bmp', tiff: 'image/tiff' };
    return map[(ext || '').toLowerCase()] || '';
  };

  U.isAllowedMime = (mime) => C.IMG.ALLOWED_MIME.includes((mime || '').toLowerCase().split(';')[0].trim());

  /** 文件名清洗：去路径、去非法字符、保扩展名 */
  U.sanitizeFileName = function (name, fallbackExt) {
    let n = String(name || '');
    n = n.split(/[\\/]/).pop();
    n = n.replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
    if (!n) n = 'image';
    n = n.replace(/^\.+/, '');
    if (fallbackExt && !/\.[a-z0-9]{2,5}$/i.test(n)) n += '.' + String(fallbackExt).toLowerCase();
    return n.slice(0, 160);
  };

  /** 默认文件名：photo-<时间戳>.<ext> */
  U.defaultFileName = function (ext) {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `web-image-${ts}.${(ext || 'jpg').toLowerCase()}`;
  };

  /** 相册名模板渲染：{domain} {date} */
  U.renderAlbumTemplate = function (template, pageUrl, dateStr) {
    const domain = U.domainOf(pageUrl) || 'web';
    const date = dateStr || new Date().toISOString().slice(0, 10);
    return String(template || C.TASK.ALBUM_NAME_TEMPLATE)
      .replace('{domain}', domain)
      .replace('{date}', date)
      .slice(0, 200);
  };

  U.formatBytes = function (n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '未知';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB'];
    let v = n;
    for (let i = -1; i < units.length; i++) {
      if (v < 1024 || i === units.length - 1) {
        return i < 0 ? v + ' B' : v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
      }
      v /= 1024;
    }
  };

  /** 从响应/魔数嗅探实际图片类型（防防盗链返回 HTML/JSON 假 200） */
  U.sniffImageMime = function (buf, declaredMime) {
    if (!buf || buf.byteLength < 12) return declaredMime && U.isAllowedMime(declaredMime) ? declaredMime : '';
    const b = new Uint8Array(buf);
    const h = (o, len) => {
      let s = '';
      for (let i = o; i < o + (len || 8) && i < b.length; i++) s += String.fromCharCode(b[i]);
      return s;
    };
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && h(1, 3) === 'PNG') return 'image/png';
    if (h(0, 4) === 'GIF8') return 'image/gif';
    if (h(0, 4) === 'RIFF' && h(8, 4) === 'WEBP') return 'image/webp';
    if (h(4, 8) === 'ftypavif' || h(4, 8) === 'ftypavis') return 'image/avif';
    if (h(4, 8) === 'ftypheic' || h(4, 8) === 'ftypheix' || h(4, 8) === 'ftypmif1' || h(4, 8) === 'ftypmsf1') return 'image/heic';
    if (h(0, 2) === 'BM') return 'image/bmp';
    // 纯文本/HTML/JSON 的特征
    const head = h(0, 200).trimStart().toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('{') || head.startsWith('[') ||
        head.startsWith('error') || head.startsWith('forbidden') || head.startsWith('not found')) return '';
    return declaredMime && U.isAllowedMime(declaredMime) ? declaredMime : '';
  };

  U.bufToBase64 = function (buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  };

  U.base64ToBytes = function (b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  /** 并发受限的 map 执行器 */
  U.mapLimit = async function (list, limit, fn) {
    const results = new Array(list.length);
    let idx = 0;
    const workers = [];
    const n = Math.max(1, Math.min(limit, list.length));
    const worker = async () => {
      while (idx < list.length) {
        const i = idx++;
        results[i] = await fn(list[i], i);
      }
    };
    for (let w = 0; w < n; w++) workers.push(worker());
    await Promise.all(workers);
    return results;
  };

  U.omit = (obj, keys) => {
    const o = {};
    const kset = new Set(keys);
    for (const k in obj) if (!kset.has(k)) o[k] = obj[k];
    return o;
  };

  PGX.U = U;
})();
