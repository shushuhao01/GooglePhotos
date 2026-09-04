/* PGX.Urls —— 图片候选 URL 提取与“缩略图 → 原图”重写规则
 * 纯函数，Node 可测。规则均为尽力而为，不承诺绝对原图。 */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const U = PGX.U;
  const C = PGX.C;

  /** 从 URL 里提取疑似尺寸参数/文件名中的尺寸信息 */
  function sizeHintFromUrl(url) {
    let w = 0, h = 0, source = '';
    try {
      const u = new URL(url);
      const lowParams = {};
      for (const [k, v] of u.searchParams.entries()) lowParams[k.toLowerCase()] = v;
      const tryNum = (keys) => {
        for (const k of keys) {
          const v = lowParams[k];
          if (v) {
            const n = parseInt(v, 10);
            if (isFinite(n) && n > 0) return n;
          }
        }
        return 0;
      };
      // 常见参数名：w/width/width_/maxwidth、h/height、sz（googleusercontent）
      w = tryNum(['w', 'width', 'maxwidth', 'width_', 'sx']);
      h = tryNum(['h', 'height', 'maxheight', 'height_', 'sy']);
      if (!w && lowParams['sz']) {
        const m = String(lowParams['sz']).match(/^(\d+)(?:-(\d+))?$/);
        if (m) { w = parseInt(m[1], 10); h = m[2] ? parseInt(m[2], 10) : w; source = 'param:sz'; }
      }
      if (w || h) source = source || 'param';
      // 文件名形如 name_1920x1080.png / -3840-w.png / @2x
      if (!source) {
        const seg = decodeURIComponent(u.pathname.split('/').pop() || '');
        const m = seg.match(/(\d{2,5})[xX×](\d{2,5})/);
        if (m) { w = parseInt(m[1], 10); h = parseInt(m[2], 10); source = 'filename'; }
      }
    } catch (e) { /* noop */ }
    return { width: w, height: h, source };
  }

  function hasTokenInUrl(url, tokens) {
    try {
      const u = new URL(url);
      const hay = (u.pathname + ' ' + u.search).toLowerCase();
      return tokens.some((t) => hay.includes(t.toLowerCase()));
    } catch (e) { return false; }
  }

  const isLikelyThumbUrl = (url) => hasTokenInUrl(url, C.IMG.THUMB_TOKENS);
  const isLikelyOriginalTokenUrl = (url) => hasTokenInUrl(url, C.IMG.ORIGINAL_TOKENS);

  /** 是否为典型的头像/图标/广告/装饰/占位图（URL 层面线索） */
  function isLikelyDecorUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      // 域名（含子域）含广告/统计域
      const host = u.hostname.toLowerCase();
      for (const d of C.IMG.DECOR_DOMAINS) {
        if (host === d || host.endsWith('.' + d)) return true;
      }
    } catch (e) { /* noop */ }
    // 路径或查询含装饰关键词
    return hasTokenInUrl(url, C.IMG.DECOR_TOKENS);
  }

  /** 结合尺寸：小图且命中装饰线索 -> 判定为装饰/头像；极小图（无尺寸线索但常为图标） */
  function classifyDecor(url, dims) {
    const urlDecor = isLikelyDecorUrl(url);
    const w = dims ? (dims.width || 0) : 0;
    const h = dims ? (dims.height || 0) : 0;
    const side = Math.max(w, h);
    const decorMax = C.IMG.DECOR_MAX_SIDE || 96;
    // 命中 URL 线索，或（两长边都小于阈值）视为小装饰图
    const byUrl = urlDecor;
    const bySize = (w > 0 && h > 0 && side > 0 && side <= decorMax);
    // 头像等：命中 URL 关键词且尺寸小；或 URL 命中且无尺寸线索
    const isAvatar = /avatar|gravatar|identicon|robohash|dicebear|ui-avatars|user_|face|person/i.test(url || '');
    const isIcon = /\/icon\/|\/icons\/|favicon|\.svg|\.ico(\?|$)/i.test(url || '');
    const isAd = /ad|ads|advert|banner|doubleclick|googlesyndication/i.test(url || '');
    return {
      decor: byUrl || bySize,
      decorReason: byUrl
        ? (isAvatar ? 'avatar' : isIcon ? 'icon' : isAd ? 'ad' : 'decor-url')
        : (bySize ? 'small' : ''),
      isAvatar, isIcon, isAd,
      urlDecor, bySize, side
    };
  }

  /**
   * 为单个元素聚合出的 URL 集合生成去重候选。
   * inputUrls 顺序即优先级（src/currentSrc 优先，其次 srcset 大图，其次 data-*）。
   * 返回 [{url, dims:{width,height,source}|null}]，已去重（按 urlKey）。
   */
  function dedupeCandidates(inputUrls) {
    const seen = new Set();
    const out = [];
    for (const raw of inputUrls) {
      const url = String(raw || '').trim();
      if (!U.isValidHttpUrl(url)) continue;
      const key = U.urlKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      const d = sizeHintFromUrl(url);
      out.push({
        url,
        dims: d.width || d.height
          ? { width: d.width || undefined, height: d.height || undefined, source: d.source || 'url' }
          : null
      });
    }
    return out;
  }

  /* ---------------- 通用原图重写规则（作用于“可能为缩略图”的 URL） ---------------- */

  function removeParamsByNames(url, names) {
    try {
      const u = new URL(url);
      for (const n of names) u.searchParams.delete(n);
      return u.href;
    } catch (e) { return url; }
  }

  function stripThumbPathSegments(url) {
    try {
      const u = new URL(url);
      const segs = u.pathname.split('/');
      let changed = false;
      // 常见 CDN 缩略段：/thumb/、/thumbnail/、/_/<x>、 /img/thumbnails/
      const drop = (p) => ['thumb', 'thumbnail', 'thumbs', 'thumbnails'].includes(p);
      const filtered = segs.filter((s) => !drop(s));
      changed = filtered.length !== segs.length;
      // 删除 googleusercontent 风格 /sXXX-xxx/ 或 /wXXX-hYYY- 段
      const filtered2 = filtered.filter((s) => !/^s\d+(-[a-z0-9-]+)?$/i.test(s) && !/^w\d+-h\d+/.test(s) && !/^\d+-c$/.test(s));
      if (filtered2.length !== filtered.length) changed = true;
      if (changed) {
        u.pathname = filtered2.join('/');
        return u.href;
      }
    } catch (e) { /* noop */ }
    return url;
  }

  /** 对单个 URL 生成“更接近原图”的候选变体（去重后返回，不含原 URL） */
  function rewriteVariants(url) {
    const variants = new Set();
    const add = (v) => { if (v && v !== url && U.isValidHttpUrl(v)) variants.add(U.urlKey(v)); };

    // 1) 去尺寸类 query 参数（w,h,width,height,resize,size,maxwidth,maxheight,imgsize,sx,sy,quality 保留原图则去掉 q?）
    const sizeParams = ['w', 'h', 'width', 'height', 'maxw', 'maxh', 'maxwidth', 'maxheight',
      'resize', 'size', 'imgsize', 'sx', 'sy', 'scale', 'zoom', 'fit', 'dw', 'dh', 'imgw', 'imgh',
      'width_', 'height_', 'sw', 'sh'];
    add(removeParamsByNames(url, sizeParams));

    // 2) 去缩略路径段
    add(stripThumbPathSegments(url));

    // 3) 文件名级替换：googleusercontent /s1600/ -> /s0/、=s1600-c / =w1600-h900 后缀 -> =s0
    try {
      const u = new URL(url);
      let path = u.pathname;
      const seg1 = path.replace(/\/s\d+(-[a-z0-9-]+)?\//, '/s0/').replace(/\/w\d+(-h\d+)?-/, '/w0-');
      if (seg1 !== path) { u.pathname = seg1; add(u.href); }
      // 形如 https://lh3.googleusercontent.com/xxxx=s1600-c 或 xxxx=w1600-h900
      const m = u.pathname.match(/=((?:s\d+)|(?:w\d+(?:-h\d+)?))(?:-[a-z0-9-]+)?$/);
      if (m) {
        u.pathname = u.pathname.replace(/=((?:s\d+)|(?:w\d+(?:-h\d+)?))(?:-[a-z0-9-]+)?$/, '=s0');
        add(u.href);
      }
    } catch (e) { /* noop */ }

    return [...variants].slice(0, 6).map((key) => {
      const real = key; // urlKey 已规范化，直接使用
      return real;
    });
  }

  /**
   * 汇总：输入 elementUrl（首选）与其它源 URL 列表，
   * 输出候选数组 [{url, dims|null, source}] + 是否疑似缩略图判定（基于首选 URL）。
   */
  function buildCandidates(primaryUrl, otherUrls) {
    const all = [primaryUrl, ...(otherUrls || [])].filter(Boolean);
    const deduped = dedupeCandidates(all);
    if (!deduped.length) return { candidates: [], likelyThumb: false };
    const primary = deduped[0].url;
    const seen = new Set(deduped.map((d) => d.url));
    const extra = [];
    if (isLikelyThumbUrl(primary)) {
      for (const v of rewriteVariants(primary)) {
        if (!seen.has(v)) { seen.add(v); extra.push({ url: v, dims: sizeHintFromUrl(v).width ? { width: sizeHintFromUrl(v).width, source: 'url' } : null, source: 'rewrite' }); }
      }
    }
    const candidates = [...deduped, ...extra].slice(0, C.IMG.CANDIDATE_URLS_PER_ITEM);
    return { candidates, likelyThumb: isLikelyThumbUrl(primary), originalToken: isLikelyOriginalTokenUrl(primary) };
  }

  PGX.Urls = {
    sizeHintFromUrl, hasTokenInUrl, isLikelyThumbUrl, isLikelyOriginalTokenUrl,
    isLikelyDecorUrl, classifyDecor,
    dedupeCandidates, rewriteVariants, buildCandidates
  };
})();
