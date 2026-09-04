/* PGX.Scoring —— 候选评分与“最佳 URL”选择（纯函数，Node 可测） */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const U = PGX.U;
  const Urls = PGX.Urls;
  const C = PGX.C;

  /** 单条候选评分：像素总量 > 长边 > 文件体积 > URL 关键词 */
  function scoreCandidate(cand, opts) {
    opts = opts || {};
    const d = cand.dims || {};
    let score = 0;
    const reasons = [];
    const w = d.width || 0;
    const h = d.height || 0;
    const area = w * h;

    if (area > 0) {
      score += Math.min(area, 24e6) / 1e4;          // 像素总量占大头
      reasons.push(`面积 ${w}x${h}`);
    } else if (w > 0 || h > 0) {
      score += (Math.max(w, h) || 0) / 4;
      reasons.push(`长边 ${Math.max(w, h)}`);
    } else {
      score += 0.5;
      reasons.push('尺寸未知');
    }
    if (cand.kind === 'srcset-w') score += 8;        // srcset w 描述符较可信
    if (cand.kind === 'srcset-x') score += 5;
    if (Urls.isLikelyOriginalTokenUrl(cand.url)) { score += 6; reasons.push('URL含原图标记'); }
    if (Urls.isLikelyThumbUrl(cand.url)) { score -= 12; reasons.push('URL疑似缩略图'); }
    if (cand.source === 'rewrite') { score -= 1; reasons.push('重写候选'); }
    if (opts.extra) {
      if (cand.url === opts.extra.primaryUrl) score += 2; // 元素实际渲染地址加分
    }
    if (cand.byteSize) score += Math.min(cand.byteSize, 5e6) / 1e5; // 体积（已知时）
    return { score, reasons, area, w, h };
  }

  /**
   * 从候选列表选最佳 URL。
   * @param candidates [{url, dims, kind, source, byteSize}]
   * @returns {url, candidates(降序), isLikelyThumb, isLikelyOriginal, dimension, warning}
   */
  function pickBest(candidates, opts) {
    opts = opts || {};
    const minSide = opts.minSide || C.IMG.DEFAULT_MIN_SIDE;
    if (!candidates || !candidates.length) return { url: '', candidates: [], isLikelyThumb: false, isLikelyOriginal: false };

    const scored = candidates.map((c) => {
      const r = scoreCandidate(c, opts);
      return { cand: c, score: r.score, area: r.area, w: r.w, h: r.h };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const sortedCandidates = scored.map((s) => s.cand);

    const dims = { width: best.w || undefined, height: best.h || undefined };
    const bestUrl = best.cand.url;
    const likelyThumb = Urls.isLikelyThumbUrl(bestUrl);
    const hasRealDims = (best.w > 0 && best.h > 0);
    const overMin = hasRealDims && (Math.max(best.w, best.h) >= minSide);
    const isLikelyOriginal = !likelyThumb && (Urls.isLikelyOriginalTokenUrl(bestUrl) || overMin || !hasRealDims);

    let warning = '';
    if (likelyThumb) warning = '疑似缩略图，已尽力匹配更大版本';
    else if (!hasRealDims) warning = '无法确认尺寸，可能非高清';
    else if (!overMin) warning = `低于高清阈值（长边 ${minSide}px）`;

    return {
      url: bestUrl,
      candidates: sortedCandidates,
      isLikelyThumb: likelyThumb,
      isLikelyOriginal: isLikelyOriginal,
      width: dims.width,
      height: dims.height,
      dimsKnown: hasRealDims,
      warning
    };
  }

  PGX.Scoring = { scoreCandidate, pickBest };
})();
