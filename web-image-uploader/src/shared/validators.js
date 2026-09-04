/* PGX.Validators —— 消息、设置、任务入参校验（纯函数，Node 可测） */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const U = PGX.U;
  const C = PGX.C;

  /** 设置白名单 + 范围钳制；非法字段回退默认值 */
  const SETTINGS_SCHEMA = {
    minSide: { d: C.IMG.DEFAULT_MIN_SIDE, clamp: [200, 8000] },
    includeGif: { d: true },
    includeCssBg: { d: true },
    scanAnchors: { d: true },
    skipDecor: { d: true },                        // 智能识别并默认隐藏头像/图标/广告/装饰图
    autoScroll: { d: true },                       // 扫描时自动滚动到页底，触发懒加载全页扫描（默认开启，保证懒加载页也能扫全）
    minWidthShow: { d: 0, clamp: [0, 4000] },      // 列表显示过滤阈值（0=全部）
    albumMode: { d: 'none', enum: ['auto', 'none', 'select', 'named'] }, // 默认直接进入相册库，不自动创建相册
    // auto 模式下可选的自定义相册名；留空时使用 auth.albumNameTemplate
    autoAlbumName: { d: '' },
    albumName: { d: '' },
    albumId: { d: '' },                            // albumMode=select 时
    useAlbumTemplate: { d: true },
    maxConcurrent: { d: C.TASK.DEFAULT_CONCURRENCY, clamp: [1, C.TASK.MAX_CONCURRENCY] },
    retries: { d: C.TASK.DEFAULT_RETRIES, clamp: [0, C.TASK.MAX_RETRIES] },
    timeoutSec: { d: C.TASK.DEFAULT_TIMEOUT_SEC, clamp: [10, C.TASK.MAX_TIMEOUT_SEC] },
    confirmBeforeUpload: { d: true },
    skipDuplicates: { d: true },
    keepHistory: { d: true },
    historyDays: { d: C.TASK.DEFAULT_HISTORY_DAYS, clamp: [1, 365] },
    singleFileLimitMB: { d: C.TASK.DEFAULT_FILE_LIMIT_MB, clamp: [1, 200] },
    maxBatch: { d: C.TASK.MAX_BATCH, clamp: [1, 1000] },
    // auth 相关
    auth: { d: { clientId: '', method: 'webauth', useMock: false, albumNameTemplate: C.TASK.ALBUM_NAME_TEMPLATE } },
    // 收费/权益相关
    billing: { d: { baseUrl: '', quoteEnabled: false, loginMode: 'dev' } }
  };

  function sanitizeSettings(raw) {
    const out = {};
    for (const [k, s] of Object.entries(SETTINGS_SCHEMA)) {
      let v = raw && raw[k] !== undefined ? raw[k] : s.d;
      if (s.clamp && typeof v === 'number') v = U.clamp(v, s.clamp[0], s.clamp[1]);
      if (s.enum && !s.enum.includes(v)) v = s.d;
      out[k] = v;
    }
    // 文本设置统一做类型与长度约束，避免来自消息的异常值进入相册创建请求。
    out.autoAlbumName = typeof out.autoAlbumName === 'string' ? out.autoAlbumName.trim().slice(0, 200) : '';
    out.albumName = typeof out.albumName === 'string' ? out.albumName.trim().slice(0, 200) : '';
    out.albumId = typeof out.albumId === 'string' ? out.albumId.trim().slice(0, 500) : '';
    const a = (raw && raw.auth) || {};
    out.auth = {
      clientId: typeof a.clientId === 'string' ? a.clientId.trim() : '',
      method: a.method === 'chromeidentity' ? 'chromeidentity' : 'webauth',
      useMock: !!a.useMock,
      albumNameTemplate: (typeof a.albumNameTemplate === 'string' && a.albumNameTemplate.trim())
        ? a.albumNameTemplate.slice(0, 200) : C.TASK.ALBUM_NAME_TEMPLATE
    };
    // billing 配置：baseUrl 去尾部斜杠、强制 http(s)
    const b = (raw && raw.billing) || {};
    let baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : '';
    baseUrl = baseUrl.replace(/\/+$/, '');
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = 'https://' + baseUrl;
    out.billing = {
      baseUrl,
      quoteEnabled: !!b.quoteEnabled,
      loginMode: b.loginMode === 'creds' ? 'creds' : 'dev'
    };
    return out;
  }

  /** START_UPLOAD 的 items 校验：返回规范化数组或 null（先过滤后限额） */
  function sanitizeUploadItems(items, max) {
    if (!Array.isArray(items) || !items.length) return null;
    const cap = max || C.TASK.MAX_BATCH;
    const out = [];
    for (const it of items) {
      const url = typeof it.url === 'string' ? it.url.trim() : '';
      if (!U.isValidHttpUrl(url)) continue;
      if (out.length >= cap) break;
      out.push({
        url,
        pageUrl: typeof it.pageUrl === 'string' && U.isValidHttpUrl(it.pageUrl) ? it.pageUrl : '',
        fileName: typeof it.fileName === 'string' ? U.sanitizeFileName(it.fileName, '') : '',
        width: Number.isFinite(it.width) ? it.width : undefined,
        height: Number.isFinite(it.height) ? it.height : undefined,
        elType: typeof it.elType === 'string' ? it.elType : ''
      });
    }
    return out.length ? out : null;
  }

  function sanitizeAuthPayload(raw) {
    const out = { clientId: '', method: 'webauth', useMock: false };
    if (!raw || typeof raw !== 'object') return out;
    out.clientId = typeof raw.clientId === 'string' ? raw.clientId.trim() : '';
    out.method = raw.method === 'chromeidentity' ? 'chromeidentity' : 'webauth';
    out.useMock = !!raw.useMock;
    return out;
  }

  PGX.Validators = { sanitizeSettings, sanitizeUploadItems, sanitizeAuthPayload, SETTINGS_SCHEMA };
})();
