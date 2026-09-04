/* PGX content: scanner —— 页面图片扫描
 * 隔离世界运行；扫描 img/picture/source、懒加载 data-*、CSS background、<a> 外链；
 * DO_SCAN 返回全量快照（SW 用其整体替换弹窗列表）；
 * MutationObserver 产生增量 SCAN_DIFF（按 URL 键去重，仅含会话内首次出现的记录）。 */
(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
  const PGX = (typeof self !== 'undefined' ? self : globalThis).PGX;
  if (!PGX || !PGX.C || !PGX.U || !PGX.Srcset || !PGX.Urls || !PGX.Scoring) return;
  const C = PGX.C;
  const U = PGX.U;
  const Srcset = PGX.Srcset;
  const Urls = PGX.Urls;
  const Scoring = PGX.Scoring;

  const state = {
    opts: null,
    seenKeys: new Set(),   // 会话内已上报过的 URL 键
    observer: null,
    flushTimer: null,
    pendingDiffs: [],
    pendingBgEls: new Set()
  };

  /* ---------- 提取工具 ---------- */

  const DATA_KEYS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-actualsrc',
    'data-full', 'data-large', 'data-url', 'data-zoom-src', 'data-src-large', 'data-src-full', 'data-echo', 'data-bg'];

  function attrImgUrls(el) {
    const out = [];
    const push = (v) => { if (v && U.isValidHttpUrl(v) && !out.some((o) => U.urlKey(o) === U.urlKey(v))) out.push(v); };
    push(el.currentSrc || '');
    push(el.getAttribute('src') || '');
    const ss = el.getAttribute('srcset');
    if (ss) for (const p of Srcset.parseSrcset(ss)) push(p.url);
    for (const k of DATA_KEYS) push(el.getAttribute(k));
    return out;
  }

  function pictureUrls(img) {
    const out = [];
    const pic = img.closest && img.closest('picture');
    if (pic) {
      for (const s of pic.querySelectorAll('source[srcset]')) {
        for (const p of Srcset.parseSrcset(s.getAttribute('srcset'))) {
          if (U.isValidHttpUrl(p.url)) out.push(p.url);
        }
      }
    }
    return out;
  }

  function cssBgUrls(el) {
    const out = [];
    try {
      const bg = getComputedStyle(el).backgroundImage || '';
      const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
      let m;
      while ((m = re.exec(bg))) {
        let v = m[2].trim();
        if (!v || v.startsWith('data:')) continue;
        if (v.startsWith('//')) v = location.protocol + v;
        if (U.isValidHttpUrl(v)) out.push(v);
      }
    } catch (e) { /* noop */ }
    return out;
  }

  function imgDims(el) {
    const nw = el.naturalWidth || 0, nh = el.naturalHeight || 0;
    if (nw && nh) return { width: nw, height: nh, source: 'natural' };
    const aw = parseInt(el.getAttribute('width'), 10) || 0;
    const ah = parseInt(el.getAttribute('height'), 10) || 0;
    if (aw && ah) return { width: aw, height: ah, source: 'attr' };
    return null;
  }

  // X 等站点的头像/表情图片尺寸可能很大，单靠 96px 尺寸阈值无法识别；
  // 读取元素语义属性作为额外装饰线索，仅对明确的 avatar/emoji 等词命中。
  function elementDecorHint(el) {
    if (!el || !el.getAttribute) return '';
    const text = ['alt', 'aria-label', 'title', 'role', 'data-testid', 'class', 'id']
      .map((k) => el.getAttribute(k) || '').join(' ').toLowerCase();
    if (/avatar|profile[-_ ]?image|user[-_ ]?photo|emoji|emoticon|reaction|sticker|verified[-_ ]?badge|follow[-_ ]?icon/.test(text)) return 'semantic-decor';
    return '';
  }

  const EXT_RE = /\.([a-z0-9]{2,5})(?:[?#]|$)/i;
  const extOf = (url) => { const m = EXT_RE.exec(url); return m ? m[1].toLowerCase() : ''; };

  /* ---------- 记录构造 ---------- */

  function buildRecord(inputUrls, meta, opts) {
    const primary = inputUrls.find((u) => U.isValidHttpUrl(u));
    if (!primary) return null;
    const { candidates, likelyThumb } = Urls.buildCandidates(primary, inputUrls);
    if (!candidates.length) return null;

    let dims = meta.naturalDims || null;
    if (!dims) {
      for (const cand of candidates) {
        if (cand.dims && (cand.dims.width || cand.dims.height)) { dims = cand.dims; break; }
      }
    }
    const selected = Scoring.pickBest(candidates, {
      minSide: opts.minSide || C.IMG.DEFAULT_MIN_SIDE,
      extra: { primaryUrl: primary }
    });
    const ext = extOf(selected.url) || extOf(primary);
    if (ext === 'gif' && !opts.includeGif) return null;

    // 装饰/头像/图标/广告判定（用于默认排除与标记）
    const bestDims = (selected.width || selected.height) ? { width: selected.width, height: selected.height } : (dims || null);
    const decor = Urls.classifyDecor(selected.url, bestDims);
    // css-bg 不再一刀切当作装饰：仅当 URL/尺寸命中装饰规则时才算装饰，
    // 否则大量以背景图承载内容图的页面会被「内容图」筛选误伤而显示为空。
    const allDecor = decor.decor || !!meta.decorHint;

    return {
      id: U.id(),
      pageUrl: location.href,
      elType: meta.elType || 'img',
      srcUrl: selected.url,
      candidates: candidates.map((cd) => ({ url: cd.url, dims: cd.dims || null, source: cd.source || 'src' })),
      width: selected.width || (dims ? dims.width : 0) || 0,
      height: selected.height || (dims ? dims.height : 0) || 0,
      dimsSource: dims ? dims.source : 'unknown',
      ext: ext || '',
      isLikelyThumb: selected.isLikelyThumb,
      isLikelyOriginal: selected.isLikelyOriginal,
      isDecor: !!allDecor,
      decorReason: decor.decorReason || meta.decorHint || '',
      isAvatar: !!decor.isAvatar,
      isIcon: !!decor.isIcon,
      isAd: !!decor.isAd,
      warning: selected.warning || ''
    };
  }

  /* ---------- 全量扫描 ---------- */

  function scanPage(opts) {
    const t0 = performance.now();
    const gathered = [];
    let truncated = false;

    // 1) <img>（含 picture/source、懒加载属性、srcset）
    for (const img of document.querySelectorAll('img')) {
      const urls = [...attrImgUrls(img), ...pictureUrls(img)];
      const rec = buildRecord(urls, { elType: 'img', naturalDims: imgDims(img), decorHint: elementDecorHint(img) }, opts);
      if (rec) gathered.push(rec);
    }

    // 2) CSS background
    if (opts.includeCssBg !== false) {
      let found = 0;
      const root = document.body || document.documentElement;
      if (root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let examined = 0, node;
        while ((node = walker.nextNode()) && found < C.IMG.BG_CAP && examined < 40000) {
          examined++;
          const bg = cssBgUrls(node);
          if (bg.length) {
            const rec = buildRecord(bg, { elType: 'css-bg' }, opts);
            if (rec) { gathered.push(rec); found++; }
          }
        }
        if (found >= C.IMG.BG_CAP || examined >= 40000) truncated = true;
      }
    }

    // 3) <a href=图片>（未内嵌 <img> 的大图链接）
    if (opts.scanAnchors !== false) {
      let n = 0;
      for (const a of document.querySelectorAll('a[href]')) {
        if (n >= C.IMG.ANCHOR_CAP) { truncated = true; break; }
        n++;
        const href = a.getAttribute('href');
        if (!href || !a.href || !U.isValidHttpUrl(href)) continue;
        const ext = extOf(href);
        if (!C.IMG.ALLOWED_EXT.includes(ext)) continue;
        if (a.querySelector('img')) continue;
        const rec = buildRecord([href], { elType: 'link' }, opts);
        if (rec) gathered.push(rec);
      }
    }

    // 4) URL 去重：同 srcUrl 只保留首个，重复者标记
    const byKey = new Map();
    const uniq = [];
    for (const rec of gathered) {
      const key = U.urlKey(rec.srcUrl);
      if (byKey.has(key)) {
        byKey.get(key).dupCount = (byKey.get(key).dupCount || 0) + 1;
        rec.isDuplicate = true;
        uniq.push(rec);
      } else {
        byKey.set(key, rec);
        uniq.push(rec);
      }
    }

    if (uniq.length > C.IMG.SCAN_CAP) { uniq.length = C.IMG.SCAN_CAP; truncated = true; }
    return {
      ok: true, candidates: uniq, truncated, pageUrl: location.href,
      scanMs: Math.round(performance.now() - t0), ts: Date.now()
    };
  }

  function noteSeen(result) {
    for (const rec of result.candidates) state.seenKeys.add(U.urlKey(rec.srcUrl));
  }

  /* ---------- 自动滚动扫描（懒加载页面） ---------- */
  // 向下逐屏滚动触发懒加载，边滚边收集；滚到页底或达到最大次数/超时后停止并汇总
  async function scanPageWithScroll(opts) {
    const t0 = performance.now();
    // 先收集当前已渲染的
    const result = scanPage(opts);
    noteSeen(result);
    const all = result.candidates.slice();
    let truncated = !!result.truncated;

    const maxScrolls = opts.maxScrolls || 60;      // 最多滚动次数（安全上限，防死循环）
    const scrollStep = opts.scrollStep || 0.9;     // 每次滚动视口高度的比例
    const scrollInterval = opts.scrollInterval || 350; // 每次滚动后等待懒加载渲染的时间
    const timeoutMs = opts.scrollTimeoutMs || 30000;    // 总超时
    const deadline = Date.now() + timeoutMs;

    const doc = document.documentElement;
    // 找到真正的滚动容器：优先 window/documentElement；否则找可滚动的祖先 div
    let scroller = null;
    try {
      const candidates = document.querySelectorAll('body, html, .scroll, .scroller, .overflow-auto, [data-scroll], main, section');
      for (const el of candidates) {
        if (!el) continue;
        const s = getComputedStyle(el);
        const canScroll = (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflow === 'auto' || s.overflow === 'scroll') &&
          el.scrollHeight > el.clientHeight + 40;
        if (canScroll) { scroller = el; break; }
      }
      if (!scroller && doc && doc.scrollHeight > (window.innerHeight || 800) + 40) scroller = doc;
    } catch (e) { scroller = null; }

    function scrollByStep() {
      const home = scroller === null || scroller === doc
        ? (window.innerHeight || doc.clientHeight || 800)
        : scroller.clientHeight || (window.innerHeight || 800);
      const step = Math.max(200, Math.round(home * scrollStep));
      if (scroller === null || scroller === doc) window.scrollBy(0, step);
      else scroller.scrollBy(0, step);
    }
    function scrollTopOf() {
      if (scroller === null || scroller === doc) { try { window.scrollTo(0, 0); } catch (e) { /* noop */ } }
      else { try { scroller.scrollTop = 0; } catch (e) { /* noop */ } }
    }
    function isAtBottom() {
      if (scroller === null || scroller === doc) {
        return (window.scrollY + window.innerHeight) >= (doc.scrollHeight - 8);
      }
      return (scroller.scrollTop + scroller.clientHeight) >= (scroller.scrollHeight - 8);
    }
    function scrollPos() {
      return scroller === null || scroller === doc ? window.scrollY : scroller.scrollTop;
    }

    // 收集新图（复用增量逻辑），并合并进去重
    function collectInto() {
      const fresh = collectNewSinceLast();
      if (!fresh.length) return 0;
      // 过滤掉与已有重复的 srcUrl
      const seen = new Set(all.map((r) => U.urlKey(r.srcUrl)));
      let added = 0;
      for (const rec of fresh) {
        const key = U.urlKey(rec.srcUrl);
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(rec);
        added++;
      }
      return added;
    }

    let prevHeight = 0;
    let stagnant = 0;
    for (let i = 0; i < maxScrolls; i++) {
      if (Date.now() > deadline) break;

      // 滚到下一屏
      const startY = scrollPos();
      const startHeight = scroller === null || scroller === doc ? doc.scrollHeight : scroller.scrollHeight;
      scrollByStep();
      await sleep(scrollInterval);
      collectInto();

      const newY = scrollPos();
      const newHeight = scroller === null || scroller === doc ? doc.scrollHeight : scroller.scrollHeight;
      // 检测是否已到底：滚动位置不再变化且高度不再增长 -> 判定到页底
      const reachedBottom = isAtBottom();
      if (reachedBottom) {
        // 再等一轮确认是否有懒加载追加
        await sleep(scrollInterval);
        collectInto();
        break;
      }
      // 停滞检测（多次滚动高度无变化即结束）
      if (newHeight === startHeight && newY === startY) stagnant++;
      else stagnant = 0;
      prevHeight = newHeight;
      if (stagnant >= 3) break;
      // 新增图过多但总超限
      if (all.length >= C.IMG.SCAN_CAP) { truncated = true; break; }
    }

    // 恢复滚动位置到顶部，方便用户从头看
    scrollTopOf();

    // 统一去重（按 srcUrl 键，首见保留，重复标记）
    const byKey = new Map();
    const uniq = [];
    for (const rec of all) {
      const key = U.urlKey(rec.srcUrl);
      if (byKey.has(key)) { byKey.get(key).dupCount = (byKey.get(key).dupCount || 0) + 1; rec.isDuplicate = true; }
      else byKey.set(key, rec);
      uniq.push(rec);
    }
    if (uniq.length > C.IMG.SCAN_CAP) { uniq.length = C.IMG.SCAN_CAP; truncated = true; }
    // 会话内去重标记
    const seenGlobal = new Set(state.seenKeys);
    for (const rec of uniq) {
      if (seenGlobal.has(U.urlKey(rec.srcUrl))) rec.isDuplicate = true;
      seenGlobal.add(U.urlKey(rec.srcUrl));
    }
    return {
      ok: true, candidates: uniq, truncated, pageUrl: location.href,
      scanMs: Math.round(performance.now() - t0), ts: Date.now(), autoScrolled: true
    };
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* ---------- MutationObserver 增量 ---------- */

  function collectNewSinceLast() {
    const opts = state.opts || { includeGif: true, includeCssBg: true, scanAnchors: true, minSide: C.IMG.DEFAULT_MIN_SIDE };
    const additions = [];
    for (const img of document.querySelectorAll('img')) {
      const urls = [...attrImgUrls(img), ...pictureUrls(img)];
      const rec = urls.length
        ? buildRecord(urls, { elType: 'img', naturalDims: imgDims(img), decorHint: elementDecorHint(img) }, opts) : null;
      if (rec) additions.push(rec);
    }
    if (state.pendingBgEls.size && opts.includeCssBg !== false) {
      for (const el of state.pendingBgEls) {
        const bg = cssBgUrls(el);
        if (bg.length) {
          const rec = buildRecord(bg, { elType: 'css-bg' }, opts);
          if (rec) additions.push(rec);
        }
      }
    }
    state.pendingBgEls.clear();
    // 仅保留本会话从未上报过的
    const fresh = [];
    for (const rec of additions) {
      const key = U.urlKey(rec.srcUrl);
      if (state.seenKeys.has(key)) continue;
      state.seenKeys.add(key);
      fresh.push(rec);
    }
    return fresh;
  }

  function queueDiff() {
    if (state.flushTimer) return;
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      const fresh = collectNewSinceLast();
      if (!fresh.length) return;
      try {
        chrome.runtime.sendMessage({
          type: C.MSG.SCAN_DIFF,
          candidates: fresh.map(stripForMsg),
          pageUrl: location.href
        });
      } catch (e) { /* 不可达则丢弃增量，下次全量重扫兜底 */ }
    }, 700);
  }

  function ensureObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && state.pendingBgEls.size < 500) state.pendingBgEls.add(n);
          }
        } else if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
          if (state.pendingBgEls.size < 500) state.pendingBgEls.add(m.target);
        }
      }
      queueDiff();
    });
    state.observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'srcset', 'style', 'class', 'data-src', 'data-original', 'data-lazy-src', 'data-srcset', 'data-bg']
    });
  }

  /* ---------- 消息 ---------- */

  function stripForMsg(rec) {
    return {
      id: rec.id, pageUrl: rec.pageUrl, elType: rec.elType, srcUrl: rec.srcUrl,
      candidates: rec.candidates, width: rec.width || 0, height: rec.height || 0,
      dimsSource: rec.dimsSource || 'unknown', ext: rec.ext || '',
      isLikelyThumb: !!rec.isLikelyThumb, isLikelyOriginal: !!rec.isLikelyOriginal,
      isDecor: !!rec.isDecor, decorReason: rec.decorReason || '',
      isAvatar: !!rec.isAvatar, isIcon: !!rec.isIcon, isAd: !!rec.isAd,
      warning: rec.warning || '', isDuplicate: !!rec.isDuplicate, dupCount: rec.dupCount || 0
    };
  }

  function probeDims(url, timeoutMs) {
    return new Promise((resolve) => {
      const img = new Image();
      const to = setTimeout(() => { img.src = ''; resolve({ ok: false, reason: 'timeout' }); }, timeoutMs || 12000);
      img.onload = () => { clearTimeout(to); resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(to); resolve({ ok: false, reason: 'error' }); };
      img.src = url;
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    switch (msg.type) {
      case C.MSG.PING:
        sendResponse({ ok: true, pong: true });
        return false;
      case C.MSG.DO_SCAN: {
        const opts = Object.assign({
          includeGif: true, includeCssBg: true, scanAnchors: true,
          minSide: C.IMG.DEFAULT_MIN_SIDE,
          autoScroll: false, maxScrolls: 60, scrollInterval: 350, scrollTimeoutMs: 30000
        }, msg.opts || {});
        state.opts = opts;
        ensureObserver();
        // 自动滚动扫描为异步，且会改动页面滚动位置；可配置
        if (opts.autoScroll) {
          scanPageWithScroll(opts)
            .then((result) => {
              result.candidates = result.candidates.map(stripForMsg);
              sendResponse(result);
            })
            .catch(() => {
              // 失败兜底：退回单次扫描
              const result = scanPage(opts);
              result.candidates = result.candidates.map(stripForMsg);
              sendResponse(result);
            });
          return true; // 异步响应
        }
        const result = scanPage(opts);
        noteSeen(result);
        result.candidates = result.candidates.map(stripForMsg);
        sendResponse(result);
        return false;
      }
      case C.MSG.SCAN_CLEAR:
        state.seenKeys.clear();
        state.pendingBgEls.clear();
        sendResponse({ ok: true });
        return false;
      case C.MSG.PROBE_SIZE: {
        probeDims(msg.url, msg.timeoutMs).then((r) => sendResponse(r));
        return true; // 异步响应
      }
      default:
        return false;
    }
  });
})();
