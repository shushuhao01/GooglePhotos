/* PGX.Srcset —— srcset/sizes 解析与选择（纯函数，Node 可测） */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;

  /**
   * 解析 srcset 字符串
   * 返回 [{url, descriptor, kind:'w'|'x'|null, value}]
   * value 为 w 时为像素宽度，为 x 时为密度倍数。
   */
  function parseSrcset(input) {
    if (typeof input !== 'string') return [];
    const out = [];
    const parts = input.split(',');
    for (const part of parts) {
      const seg = part.trim();
      if (!seg) continue;
      const tokens = seg.split(/\s+/);
      const url = tokens[0];
      // 过滤 data URI、无意义短串（须含路径分隔符或扩展名点，或已是绝对 URL）
      if (!url) continue;
      if (url.startsWith('data:')) continue;
      if (!url.includes('/') && !url.includes('.') && !url.startsWith('http')) continue;
      let descriptor = '';
      let kind = null;
      let value = null;
      if (tokens[1]) {
        descriptor = tokens[1];
        const m = descriptor.match(/^([\d.]+)([wx])$/);
        if (m) {
          kind = m[2];
          value = parseFloat(m[1]);
        }
      }
      out.push({ url, descriptor, kind, value, width: kind === 'w' ? value : undefined });
    }
    return out;
  }

  /** 解析 sizes 属性（简化：返回每条媒体条件与长度，供选择时参考） */
  function parseSizes(input) {
    if (typeof input !== 'string') return [];
    const out = [];
    for (const seg of input.split(',')) {
      const t = seg.trim();
      if (!t) continue;
      const sp = t.split(/\s+/);
      out.push({ media: sp.length > 1 ? sp[0] : '', size: sp[sp.length - 1] });
    }
    return out;
  }

  /** 从解析结果里挑出“最大”项：优先 w 描述符，其次 x 描述符 */
  function pickLargest(parsed) {
    if (!parsed.length) return null;
    let best = null;
    for (const p of parsed) {
      if (!best) { best = p; continue; }
      const a = p.kind === 'w' ? (p.value || 0) : (p.kind === 'x' ? (p.value || 0) * 1000 : 0);
      const b = best.kind === 'w' ? (best.value || 0) : (best.kind === 'x' ? (best.value || 0) * 1000 : 0);
      if (a > b) best = p;
    }
    return best;
  }

  PGX.Srcset = { parseSrcset, parseSizes, pickLargest };
})();
