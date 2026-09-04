/* PGX 命名空间引导 + 全局常量
 * 全部共享/后台/content 模块均为经典脚本（IIFE），将 API 挂到全局 PGX 上。
 * 浏览器扩展环境挂到 self/globalThis；Node 单测环境同样挂到 globalThis，可直接 require。 */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;

  PGX.C = {
    NAME: '网页图片上传 Google 相册',
    VERSION: '1.0.0',

    // ---- 消息类型 ----
    MSG: {
      // 弹窗 <-> Service Worker
      GET_INIT: 'get_init',
      SCAN_TAB: 'scan_tab',           // popup -> sw -> content
      SCAN_RESULT: 'scan_result',     // content -> sw（全量快照）
      SCAN_DIFF: 'scan_diff',         // content -> sw（增量）
      SCAN_CLEAR: 'scan_clear',
      GET_TASKS: 'get_tasks',
      GET_TASK: 'get_task',
      START_UPLOAD: 'start_upload',
      CANCEL_TASK: 'cancel_task',
      PAUSE_TASK: 'pause_task',
      RESUME_TASK: 'resume_task',
      RETRY_ITEM: 'retry_item',
      RETRY_FAILED: 'retry_failed',
      RETRY_HISTORY: 'retry_history',
      LIST_HISTORY: 'list_history',
      CLEAR_HISTORY: 'clear_history',
      GET_SETTINGS: 'get_settings',
      SAVE_SETTINGS: 'save_settings',
      GET_AUTH: 'get_auth',
      LOGIN: 'login',
      LOGOUT: 'logout',
      REQUEST_HOST_PERMS: 'request_host_perms',
      // 收费/权益（popup <-> sw <-> 后端）
      BILLING_LOGIN: 'billing_login',
      BILLING_LOGOUT: 'billing_logout',
      BILLING_STATUS: 'billing_status',
      BILLING_PLANS: 'billing_plans',
      BILLING_CHECKOUT: 'billing_checkout',
      BILLING_TEST: 'billing_test',
      GET_PUBLIC_CONFIG: 'get_public_config',
      // Service Worker -> popup（事件）
      TASK_EVENT: 'task_event',
      AUTH_CHANGED: 'auth_changed',
      AUTH_REQUIRED: 'auth_required',
      SCAN_EVENT: 'scan_event',
      QUOTA_CHANGED: 'quota_changed',
      // sw -> content
      PING: 'ping',
      DO_SCAN: 'do_scan',
      DOWNLOAD_IMAGE: 'download_image',   // sw -> content（页面上下文抓取）
      FETCH_MAIN: 'fetch_main',           // sw -> content（MAIN world 抓取）
      PROBE_SIZE: 'probe_size',
      PROXY_THUMB: 'proxy_thumb'          // popup -> sw：抓取图片并以 dataURL 返回（用于防盗链缩略图展示）
    },

    // ---- Google OAuth / API ----
    AUTH: {
      SCOPES: [
        'https://www.googleapis.com/auth/photoslibrary.appendonly',
        'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
        'openid',
        'email'
      ],
      AUTHZ_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
      TOKEN_URL: 'https://oauth2.googleapis.com/token',
      REVOKE_URL: 'https://oauth2.googleapis.com/revoke',
      USERINFO_URL: 'https://www.googleapis.com/oauth2/v3/userinfo',
      PHOTOS_ROOT: 'https://photoslibrary.googleapis.com/v1',
      MIN_EXPIRY_MS: 60 * 1000 // access token 剩余不足 60s 视为过期
    },

    // ---- 图片 ----
    IMG: {
      ALLOWED_EXT: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'bmp', 'tiff'],
      ALLOWED_MIME: [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'image/avif', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff'
      ],
      MAX_URL_LEN: 2048,
      SCAN_CAP: 1200,          // 单次扫描候选上限（超出截断并提示）
      ANCHOR_CAP: 800,         // <a> 外链扫描上限
      BG_CAP: 2500,            // CSS background 元素扫描上限
      CANDIDATE_URLS_PER_ITEM: 8, // 每个条目最多保留候选 URL 数
      THUMB_TOKENS: ['thumb', 'thumbnail', 'thumbs', 'tb_', 'small', 'mini',
        'avatar', 'ico', 'icon', 's_', '_s', 'w50', 'w100', 'w150', 'w200',
        'x50', 'x100', 'x150', 'x200', '40x40', '80x80', '150x150', '200x200', '300x300'],
      ORIGINAL_TOKENS: ['original', 'full', 'large', 'master', 'origin', 'hd', 'hi-res', 'highres'],
      // 常见“装饰/头像/图标/广告/小部件” URL 关键词（命中则优先排除或降权）
      DECOR_TOKENS: ['avatar', 'gravatar', 'dicebear', 'robohash', 'ui-avatars', 'identicon',
        '/icons/', '/icon/', '/logo', 'favicon', '/emoji', 'emoji', 'sprite', 'sprites', 'sprite.png',
        '/ad', 'ads', 'advert', 'banner_ad', 'adserv', 'doubleclick', '/ads/', 'adslot',
        'beacon', 'pixel', '/spacer', '/blank', 'placeholder', 'loading.gif', 'transparent.gif',
        '/badge', 'wechat_qr', '/qrcode', '/map_', '/marker', '/pin', '/dot_', '/separator', '/divider'],
      DECOR_DOMAINS: ['googleads', 'googlesyndication', 'doubleclick', 'scorecardresearch',
        'quantserve', 'criteo', 'taboola', 'outbrain', 'adservice'],
      // 认定为“装饰图/头像”的尺寸阈值：两长边均小于该值且命中 DECOR 规则
      DECOR_MAX_SIDE: 96,
      TINY_BYTES: 10 * 1024,   // 小于该体积且像素可疑 -> 疑似占位图
      DEFAULT_MIN_SIDE: 1600   // 高清阈值（设置中可改）
    },

    // ---- 任务 ----
    TASK: {
      MAX_BATCH: 500,
      DEFAULT_CONCURRENCY: 2,
      MAX_CONCURRENCY: 4,
      DEFAULT_RETRIES: 2,
      MAX_RETRIES: 3,
      DEFAULT_TIMEOUT_SEC: 30,
      MAX_TIMEOUT_SEC: 120,
      DEFAULT_FILE_LIMIT_MB: 50,
      DEFAULT_HISTORY_DAYS: 30,
      DEFAULT_HASH_CAP: 5000,
      ALBUM_NAME_TEMPLATE: '网页图片-{domain}-{date}',
      STAGE_WEIGHT: { downloading: 40, uploading: 60 },
      PROGRESS_BROADCAST_MS: 150
    },

    // ---- 下载 ----
    DL: {
      BASE64_CHUNK: 1_500_000,      // MAIN world -> content 每块 base64 字符数
      PORT_CHUNK: 6 * 1024 * 1024,  // content -> sw 每块字节数
      MAX_BODY: 50 * 1024 * 1024
    },

    // ---- 任务/条目状态 ----
    TASK_STATUS: ['queued', 'running', 'paused', 'completed', 'cancelled', 'failed'],
    ITEM_STATUS: ['queued', 'downloading', 'uploading', 'success', 'failed', 'skipped', 'cancelled'],

    // ---- 错误码（用户可读映射见 popup/background 统一字典） ----
    ERR: {
      NETWORK: 'NETWORK', CORS: 'CORS', HTTP: 'HTTP', TIMEOUT: 'TIMEOUT',
      NOT_IMAGE: 'NOT_IMAGE', FILE_TOO_LARGE: 'FILE_TOO_LARGE', EMPTY: 'EMPTY',
      AUTH_EXPIRED: 'AUTH_EXPIRED', AUTH_DENIED: 'AUTH_DENIED',
      RATE_LIMITED: 'RATE_LIMITED', QUOTA: 'QUOTA', SERVER: 'SERVER',
      ALBUM_NOT_FOUND: 'ALBUM_NOT_FOUND', BAD_REQUEST: 'BAD_REQUEST',
      DUPLICATE: 'DUPLICATE', UNSUPPORTED: 'UNSUPPORTED', CANCELLED: 'CANCELLED'
    }
  };

  PGX.C.ERROR_TEXT = {
    [PGX.C.ERR.NETWORK]: '网络连接失败',
    [PGX.C.ERR.CORS]: '网站禁止跨域读取该图片，已尝试替代方案失败',
    [PGX.C.ERR.HTTP]: '图片地址返回异常状态码',
    [PGX.C.ERR.TIMEOUT]: '下载超时',
    [PGX.C.ERR.NOT_IMAGE]: '内容不是可识别的图片格式',
    [PGX.C.ERR.FILE_TOO_LARGE]: '文件超过大小限制',
    [PGX.C.ERR.EMPTY]: '下载内容为空',
    [PGX.C.ERR.AUTH_EXPIRED]: 'Google 账号授权已失效，请重新绑定',
    [PGX.C.ERR.AUTH_DENIED]: '授权被取消或拒绝',
    [PGX.C.ERR.RATE_LIMITED]: 'Google Photos 暂时限流，稍后自动重试',
    [PGX.C.ERR.QUOTA]: '今日 API 配额已用完，请明天再试',
    [PGX.C.ERR.SERVER]: 'Google Photos 服务异常，稍后自动重试',
    [PGX.C.ERR.ALBUM_NOT_FOUND]: '目标相册不存在或无权限访问',
    [PGX.C.ERR.BAD_REQUEST]: '请求参数错误',
    [PGX.C.ERR.DUPLICATE]: '内容与本地上传记录重复，已跳过',
    [PGX.C.ERR.UNSUPPORTED]: '图片格式不受 Google Photos 支持',
    [PGX.C.ERR.CANCELLED]: '任务已取消'
  };
})();
