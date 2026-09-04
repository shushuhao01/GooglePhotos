/* PGX Service Worker —— 消息路由 / 生命周期 / 广播
 * 经典脚本 + importScripts 加载各模块；所有长期任务在 Uploads 中运行。 */
importScripts(
  '../shared/constants.js',
  '../shared/utils.js',
  '../shared/srcset.js',
  '../shared/urls.js',
  '../shared/scoring.js',
  '../shared/validators.js',
  'task-store.js',
  'auth-manager.js',
  'photos-client.js',
  'downloader.js',
  'upload-manager.js',
  '../shared/billing-api.js'
);

const C = globalThis.PGX.C;
const Store = globalThis.PGX.Store;
const Auth = globalThis.PGX.Auth;
const Photos = globalThis.PGX.Photos;
const Uploads = globalThis.PGX.Uploads;
const Validators = globalThis.PGX.Validators;
const Billing = globalThis.PGX.Billing;
const U = globalThis.PGX.U;

let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}
async function init() {
  await Uploads.init();
  await Uploads.restore();
  // 注入收费后端配置缓存
  const settings = await Store.getSettings();
  Billing.setSettings(settings);
  // 通知管道（仅推送给已打开的弹窗长连接，避免打扰 content script）
  Uploads.setNotifier((payload) => { broadcast(payload); updateBadge(); });
  Auth.on('change', (p) => {
    broadcast({ type: C.MSG.AUTH_CHANGED, state: null });
    if (p && p.auth) Uploads.resumeAuthPaused();
    else if (!p || !p.auth) { /* logout 无操作 */ }
  });
  Auth.on('required', (p) => broadcast({ type: C.MSG.AUTH_REQUIRED, reason: (p && p.reason) || '' }));
  updateBadge();
  buildContextMenus();
}

/* ---------------- 工具栏角标：进行中任务数 ---------------- */
function updateBadge() {
  try {
    const n = Uploads.getActive().filter((t) => t.status === 'running').length;
    chrome.action.setBadgeText({ text: n ? String(n) : '' }).catch(() => null);
    chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' }).catch(() => null);
  } catch (e) { /* noop */ }
}

/* ---------------- 右键菜单 ---------------- */
const MENU = { ROOT: 'pgx-root', UPLOAD_IMG: 'pgx-upload-image', COPY_URL: 'pgx-copy-url', SCAN_PAGE: 'pgx-scan-page' };

function buildContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    const parent = chrome.contextMenus.create({
      id: MENU.ROOT, title: '网页图片上传 Google 相册',
      contexts: ['page', 'image', 'link']
    });
    chrome.contextMenus.create({
      id: MENU.UPLOAD_IMG, parentId: parent, title: '上传图片到 Google 相册（高清优先）',
      contexts: ['image', 'link']
    });
    chrome.contextMenus.create({
      id: MENU.COPY_URL, parentId: parent, title: '复制候选原图地址',
      contexts: ['image']
    });
    chrome.contextMenus.create({
      id: MENU.SCAN_PAGE, parentId: parent, title: '扫描本页图片并批量上传…',
      contexts: ['page']
    });
  });
}

chrome.contextMenus && chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  const url = resolveMenuUrl(info);
  const id = info.menuItemId;
  if (id === MENU.SCAN_PAGE) { scanAndOpenPopup(tab); return; }
  if (id === MENU.COPY_URL && url) { copyBestUrl(tab, url); return; }
  if (id === MENU.UPLOAD_IMG && url) { contextUpload(tab, url).catch(() => null); }
});

function resolveMenuUrl(info) {
  const u = (info.srcUrl && U.isValidHttpUrl(info.srcUrl)) ? info.srcUrl
    : (info.linkUrl && U.isValidHttpUrl(info.linkUrl)) ? info.linkUrl : '';
  return u;
}

async function openPopup() {
  try { if (chrome.action && chrome.action.openPopup) await chrome.action.openPopup(); } catch (e) { /* 个别环境不支持则忽略 */ }
}

async function scanAndOpenPopup(tab) {
  try {
    const r = await doScan(tab.id, true);
    if (!r || !r.ok) {
      chrome.action.setBadgeText({ text: '!' });
      return;
    }
    await openPopup();
  } catch (e) { /* noop */ }
}

/** 用共享规则推断“更接近原图”的地址（含缩略图重写） */
async function resolveBestUrl(url) {
  const settings = await Store.getSettings();
  const { candidates } = PGX.Urls.buildCandidates(url, []);
  const picked = PGX.Scoring.pickBest(
    candidates.map((cd) => ({ url: cd.url, dims: cd.dims || null, source: cd.source || 'src' })),
    { minSide: settings.minSide || C.IMG.DEFAULT_MIN_SIDE }
  );
  return picked.url || url;
}

async function copyBestUrl(tab, url) {
  const best = await resolveBestUrl(url).catch(() => url);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (txt) => {
        const done = () => true;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt));
        }
        return Promise.resolve(fallbackCopy(txt));
        function fallbackCopy(t) {
          try {
            const ta = document.createElement('textarea');
            ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
            return true;
          } catch (e) { return false; }
        }
      },
      args: [best]
    });
  } catch (e) { /* 复制失败静默 */ }
}

async function contextUpload(tab, url) {
  // 授权（含首次交互式登录）；未配置 ClientID 时引导到设置页
  try {
    await Auth.ensureToken(true);
  } catch (e) {
    if (e && e.code === 'NO_CLIENT_ID') { chrome.runtime.openOptionsPage(); }
    return;
  }
  // 申请「所有网站」主机权限：这是绕过跨域/防盗链、让后台直连下载的关键（否则右键上传会失败）
  // 右键点击属于用户手势，具备 request 权限的合法性。
  try {
    const hasAll = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
    if (!hasAll) {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
      if (granted) console.log('[PGX] 右键上传：已获得所有网站下载权限');
    }
  } catch (e) { /* 权限申请失败静默：仍尝试页面上下文抓取 */ }

  const settings = await Store.getSettings();
  const target = await resolveBestUrl(url).catch(() => url);
  const taskId = await Uploads.createTask({
    items: [{ url: target, fileName: '', width: 0, height: 0 }],
    pageUrl: tab.url || '',
    albumMode: settings.albumMode || 'none',
    albumId: settings.albumMode === 'select' ? (settings.albumId || '') : '',
    albumName: settings.albumMode === 'named' ? (settings.albumName || '') : '',
    tabId: tab.id
  });
  updateBadge();
  await openPopup().catch(() => null);
}

const popupPorts = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'popup-sync') return;
  popupPorts.add(port);
  const leave = () => popupPorts.delete(port);
  port.onDisconnect.addListener(leave);
});

function broadcast(payload) {
  for (const p of [...popupPorts]) {
    try { p.postMessage(payload); } catch (e) { popupPorts.delete(p); }
  }
}

/* ---------------- 消息处理 ---------------- */

async function ensureContent(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      'src/shared/constants.js', 'src/shared/utils.js', 'src/shared/srcset.js',
      'src/shared/urls.js', 'src/shared/scoring.js', 'src/shared/validators.js',
      'src/content/scanner.js', 'src/content/page-bridge.js'
    ]
  });
}

function sendTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || 'no receiver'));
      else resolve(resp);
    });
  });
}

async function doScan(tabId, force) {
  const settings = await Store.getSettings();
  await ensureContent(tabId);
  const resp = await sendTab(tabId, {
    type: C.MSG.DO_SCAN,
    opts: {
      includeGif: settings.includeGif,
      includeCssBg: settings.includeCssBg,
      scanAnchors: settings.scanAnchors,
      minSide: settings.minSide,
      autoScroll: !!settings.autoScroll,
      maxScrolls: 60,
      scrollInterval: 350,
      scrollTimeoutMs: 30000
    }
  });
  if (resp && resp.ok) {
    const snapshot = {
      candidates: resp.candidates || [],
      truncated: !!resp.truncated, pageUrl: resp.pageUrl,
      scanMs: resp.scanMs, ts: Date.now()
    };
    await Store.saveScan(tabId, snapshot);
    return { ok: true, snapshot };
  }
  return { ok: false, message: '扫描失败' };
}

function mergeScanDiff(senderTabId, candidates) {
  return Store.getScan(senderTabId).then(async (snap) => {
    snap = snap || { candidates: [], pageUrl: '', truncated: false, ts: Date.now() };
    const seen = new Set(snap.candidates.map((c) => c.id));
    const fresh = (candidates || []).filter((c) => !seen.has(c.id));
    if (!fresh.length) return null;
    snap.candidates = snap.candidates.concat(fresh).slice(0, 1500);
    snap.ts = Date.now();
    await Store.saveScan(senderTabId, snap);
    return { additions: fresh };
  });
}

async function handle(msg, sender) {
  switch (msg.type) {
    case C.MSG.GET_INIT: {
      const [auth, settings, tasks, activeTab] = await Promise.all([
        Auth.getState(), Store.getSettings(), Uploads.getActive(), getActiveTabId()
      ]);
      let scan = null;
      if (activeTab) scan = await Store.getScan(activeTab);
      return { ok: true, auth, settings, tasks, scan, tabId: activeTab, version: C.VERSION };
    }

    case C.MSG.SCAN_TAB: {
      const tabId = msg.tabId || (sender.tab && sender.tab.id);
      try {
        const r = await doScan(tabId, !!msg.force);
        return r;
      } catch (e) {
        const m = String((e && e.message) || e);
        if (/cannot access|host permission|Receiving end|scripting/i.test(m)) {
          return { ok: false, code: 'NO_PERMISSION', message: '无法访问该页面，请刷新后重试（或在扩展设置中授权站点）' };
        }
        return { ok: false, message: m };
      }
    }

    case C.MSG.GET_AUTH:
      return { ok: true, state: await Auth.getState() };

    case C.MSG.LOGIN:
      try {
        await Auth.login();
        const state = await Auth.getState();
        const resumed = Uploads.resumeAuthPaused();
        return { ok: true, state, resumed };
      } catch (e) {
        return { ok: false, code: (e && e.code) || 'AUTH_FAILED', message: (e && e.message) || '登录失败' };
      }

    case C.MSG.LOGOUT:
      await Auth.logout(true);
      return { ok: true };

    case C.MSG.GET_SETTINGS:
      return { ok: true, settings: await Store.getSettings() };

    case C.MSG.SAVE_SETTINGS: {
      const settings = Validators.sanitizeSettings(msg.settings || {});
      const saved = await Store.saveSettings(settings);
      Billing.setSettings(saved);
      await Uploads.refreshSettings();
      return { ok: true, settings: saved };
    }

    /* ---------- 收费/权益 ---------- */
    case C.MSG.BILLING_TEST: {
      const r = await Billing.testConnection(msg.baseUrl || '');
      return { ok: true, ...r };
    }

    case C.MSG.BILLING_LOGIN: {
      try {
        const auth = await Billing.login({
          mode: msg.mode || 'dev', email: msg.email || '', password: msg.password || '', register: !!msg.register
        });
        // 登录成功 -> 查询权益并广播
        const status = await Billing.status();
        broadcast({ type: C.MSG.QUOTA_CHANGED, status });
        return { ok: true, auth, status };
      } catch (e) {
        return { ok: false, code: (e && e.code) || 'BILLING_LOGIN_FAILED', message: (e && e.message) || '登录失败' };
      }
    }

    case C.MSG.BILLING_LOGOUT: {
      await Billing.logout();
      broadcast({ type: C.MSG.QUOTA_CHANGED, status: null });
      return { ok: true };
    }

    case C.MSG.BILLING_STATUS: {
      // 无登录直接返回未登录态
      const auth = await Billing.getAuth();
      if (!auth || !auth.token) return { ok: true, configured: Billing.isConfigured(), loggedIn: false, status: null };
      try {
        const status = await Billing.status();
        return { ok: true, configured: Billing.isConfigured(), loggedIn: true, status };
      } catch (e) {
        return { ok: false, configured: Billing.isConfigured(), loggedIn: false, message: (e && e.message) || '查询失败', code: (e && e.code) };
      }
    }

    case C.MSG.BILLING_PLANS: {
      try {
        const plans = await Billing.plans();
        const auth = await Billing.getAuth();
        return { ok: true, plans, loggedIn: !!(auth && auth.token) };
      } catch (e) {
        return { ok: false, message: (e && e.message) || '获取套餐失败', code: (e && e.code) };
      }
    }

    /* 公开站点配置：公告/维护/站点（无需登录） */
    case C.MSG.GET_PUBLIC_CONFIG: {
      try {
        const config = await Billing.publicConfig();
        return { ok: true, config };
      } catch (e) {
        return { ok: false, message: (e && e.message) || '获取公告失败', code: (e && e.code) };
      }
    }

    case C.MSG.BILLING_CHECKOUT: {
      // 购买/升级：创建订单；mock 渠道直接支付
      try {
        const info = await Billing.checkout(msg.planCode || '', msg.provider || 'mock', msg.idempotencyKey);
        let order = info;
        if (msg.autoPay && info.orderNo) {
          const r = await Billing.mockPay(info.orderNo);
          order = { ...info, autoPaid: !!(r && r.ok), payStatus: r && r.status };
        }
        const status = await Billing.status();
        broadcast({ type: C.MSG.QUOTA_CHANGED, status });
        return { ok: true, order, status };
      } catch (e) {
        return { ok: false, code: (e && e.code) || 'CHECKOUT_FAILED', message: (e && e.message) || '下单失败' };
      }
    }

    case C.MSG.REQUEST_HOST_PERMS: {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
      return { ok: true, granted: !!granted };
    }

    case C.MSG.START_UPLOAD: {
      const settings = await Store.getSettings();
      const items = Validators.sanitizeUploadItems(msg.items, settings.maxBatch);
      if (!items) return { ok: false, message: '没有有效的图片条目' };
      // 首次上传前确保授权（交互式，让弹窗拉起授权）
      try {
        await Auth.ensureToken(true);
      } catch (e) {
        if (e && e.code === 'NO_CLIENT_ID') return { ok: false, code: 'NO_CLIENT_ID', message: '尚未配置 Google OAuth Client ID，请先到设置页填写' };
        return { ok: false, code: (e && e.code) || C.ERR.AUTH_DENIED, message: (e && e.message) || '授权失败' };
      }
      // 收费权益校验：预扣一次上传额度（仅当已配置后端且开启配额校验）
      let billing = null;
      try {
        if (settings.billing && settings.billing.quoteEnabled && Billing.isConfigured()) {
          billing = await Billing.reserve('upload');
        }
      } catch (e) {
        // 额度不足 -> 明确提示升级；其他错误（网络/未配置）静默放行，避免误伤
        if (e && (e.code === 'QUOTA_EXCEEDED')) {
          return { ok: false, code: 'QUOTA_EXCEEDED', message: Billing.quotaMessage(e), upgrade: true };
        }
        billing = null;
      }
      // 尝试申请「所有网站」主机权限：有了它，Service Worker 可直接 fetch 图片（绕过 CORS，速度快且更稳）。
      // 用户可能拒绝，拒绝也不影响（仍有页面上下文抓取兜底），只是速度/成功率略降。
      try {
        const hasAll = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
        if (!hasAll) {
          const granted = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
          if (granted) console.log('[PGX] 已获得所有网站下载权限');
        }
      } catch (e) { /* 权限申请失败静默：仍可走页面上下文抓取 */ }
      const taskId = await Uploads.createTask({
        items, pageUrl: msg.pageUrl || '',
        albumMode: msg.albumMode || settings.albumMode || 'none',
        albumId: msg.albumId || '', albumName: msg.albumName || '',
        tabId: sender.tab ? sender.tab.id : (msg.tabId || null),
        billing: billing || null
      });
      return { ok: true, taskId, billing };
    }

    case C.MSG.GET_TASKS:
      return { ok: true, tasks: Uploads.getActive() };

    case C.MSG.GET_TASK:
      return { ok: true, task: Uploads.getTask(msg.taskId) };

    case C.MSG.CANCEL_TASK:
      return { ok: Uploads.cancelTask(msg.taskId) };
    case C.MSG.PAUSE_TASK:
      return { ok: Uploads.pauseTask(msg.taskId) };
    case C.MSG.RESUME_TASK:
      return { ok: Uploads.resumeTask(msg.taskId) };
    case C.MSG.RETRY_ITEM:
      return { ok: Uploads.retryItem(msg.taskId, msg.itemId) };
    case C.MSG.RETRY_FAILED:
      return { ok: Uploads.retryFailed(msg.taskId) };

    case C.MSG.LIST_HISTORY:
      return { ok: true, history: await Store.getHistory() };

    case C.MSG.CLEAR_HISTORY:
      await Store.clearHistory();
      return { ok: true };

    case C.MSG.RETRY_HISTORY: {
      try {
        const taskId = await Uploads.retryFromHistory(msg.entryId);
        return { ok: true, taskId };
      } catch (e) {
        return { ok: false, message: (e && e.message) || '重试失败' };
      }
    }

    case 'list_albums': {
      try {
        await Auth.ensureToken(true);
      } catch (e) {
        return { ok: false, message: (e && e.message) || '请先登录' };
      }
      const r = await Photos.listAlbums(async (i, force) => Auth.ensureToken(i, force));
      if (r.ok) return { ok: true, albums: r.albums || [] };
      return { ok: false, message: (r.error && (r.error.message || C.ERROR_TEXT[r.error.code])) || '获取相册失败' };
    }

    case 'request_host_perms_check':
      return { ok: true };

    case C.MSG.PROXY_THUMB: {
      // popup 请求抓取一张图并以 dataURL 返回，用于防盗链页面的缩略图展示
      const url = msg.url;
      if (!url || !U.isValidHttpUrl(url)) return { ok: false, message: '图片地址无效' };
      const dl = await Downloader.download(url, msg.tabId || null, {
        timeoutSec: 20, fileLimitMB: 8, referrer: msg.referrer || ''
      }).catch(() => null);
      if (!dl || !dl.ok || !dl.bytes) return { ok: false, code: (dl && dl.code) || C.ERR.NETWORK, message: (dl && dl.message) || '抓取失败' };
      const mime = dl.mime || 'image/jpeg';
      const b64 = U.bufToBase64(dl.bytes);
      return { ok: true, dataUrl: 'data:' + mime + ';base64,' + b64 };
    }

    case 'download_image_bytes': {
      if (!msg.url || !U.isValidHttpUrl(msg.url)) return { ok: false, message: '图片地址无效' };
      const dl = await Downloader.download(msg.url, msg.tabId || null, { timeoutSec: 30, referrer: msg.referrer || '' });
      if (!dl || !dl.ok) return { ok: false, code: dl && dl.code, message: dl && dl.message };
      return { ok: true, bytes: dl.bytes, mime: dl.mime || 'application/octet-stream' };
    }

    case 'download_url_native': {
      if (!msg.url || !U.isValidHttpUrl(msg.url) || !chrome.downloads) return { ok: false, message: '原生下载不可用' };
      const id = await new Promise((resolve) => chrome.downloads.download({
        url: msg.url, filename: U.sanitizeFileName(msg.fileName || 'image', 'image'), saveAs: !!msg.saveAs, conflictAction: 'uniquify'
      }, (downloadId) => resolve(chrome.runtime.lastError ? null : downloadId)));
      return id == null ? { ok: false, message: 'Chrome 下载失败' } : { ok: true, downloadId: id };
    }

    case 'open_full_preview': {
      if (!msg.url || !U.isValidHttpUrl(msg.url) || !chrome.windows) return { ok: false, message: '全屏预览不可用' };
      const list = Array.isArray(msg.urls) && msg.urls.length ? msg.urls.slice(0, 300) : [msg.url];
      const url = chrome.runtime.getURL('src/preview.html') + '?url=' + encodeURIComponent(msg.url) + '&index=' + encodeURIComponent(msg.index || 0) + '&urls=' + encodeURIComponent(JSON.stringify(list));
      const win = await chrome.windows.create({ url, type: 'popup', state: 'fullscreen' });
      return { ok: true, windowId: win && win.id };
    }

    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  ready().then(() => handle(msg, sender))
    .then((r) => {
      if (r !== null && r !== undefined) sendResponse(r);
    })
    .catch((e) => sendResponse({ ok: false, message: String((e && e.message) || e) }));
  return true; // 异步响应
});

// content 增量扫描 -> 合并快照 -> 广播给 popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || msg.type !== C.MSG.SCAN_DIFF) return false;
  const tabId = sender.tab ? sender.tab.id : null;
  if (!tabId) return false;
  ready().then(() => mergeScanDiff(tabId, msg.candidates))
    .then((merged) => {
      if (merged) broadcast({ type: C.MSG.SCAN_EVENT, tabId, additions: merged.additions });
    })
    .catch(() => null);
  return false;
});

async function getActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? tab.id : null;
  } catch (e) { return null; }
}

/* ---------------- 生命周期 ---------------- */

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create('pgx-pump', { periodInMinutes: 1 }).catch(() => null);
  ready();
});

chrome.runtime.onStartup.addListener(() => ready());

// 心跳：任务处于运行中时周期性唤醒（配合 Uploads 内调度兜底 SW 被回收的场景）
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === 'pgx-pump') {
    ready().then(() => Uploads.restore().catch(() => null)).catch(() => null);
  }
});
