/* PGX.Uploads —— 上传任务队列管理器
 * 特性：多任务并行调度（每任务并发 1-4）、逐项状态机、批量 batchCreate(≤50) 聚合、
 *       自动重试（指数退避）、取消/暂停/恢复、去重（SHA-256 本地索引）、
 *       持久化与 SW 重启恢复、进度事件通知。 */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const Store = PGX.Store;
  const U = PGX.U;
  const C = PGX.C;
  const Photos = PGX.Photos;
  const Downloader = PGX.Downloader;
  const Billing = PGX.Billing;   // 可能为 undefined（SW 未加载 billing-api 时），调用前判空

  const RETRIABLE = new Set([C.ERR.NETWORK, C.ERR.TIMEOUT, C.ERR.SERVER, C.ERR.RATE_LIMITED]);

  const mem = {
    tasks: new Map(),   // id -> task
    inflight: new Map(),// id -> count
    buckets: new Map(), // id -> {albumId, tokens:[], items:[]}
    bucketTimers: new Map(),
    stopped: new Set(), // 已请求停止的任务
    notify: null,
    saveTimer: null,
    dirty: false,
    lastActivity: 0     // 最近一次调度/处理活动时间（判断 SW 是否仍存活）
  };

  /* ---------------- 通知与持久化（节流） ---------------- */

  function notify(payload) {
    if (mem.notify) { try { mem.notify(payload); } catch (e) { /* noop */ } }
  }

  function scheduleSave() {
    mem.dirty = true;
    if (mem.saveTimer) return;
    mem.saveTimer = setTimeout(async () => {
      mem.saveTimer = null;
      if (!mem.dirty) return;
      mem.dirty = false;
      const map = {};
      for (const [id, t] of mem.tasks) map[id] = t;
      await Store.saveTasksMap(map).catch(() => null);
    }, 600);
  }

  async function persistNow() {
    if (mem.saveTimer) { clearTimeout(mem.saveTimer); mem.saveTimer = null; }
    const map = {};
    for (const [id, t] of mem.tasks) map[id] = t;
    await Store.saveTasksMap(map).catch(() => null);
    mem.dirty = false;
  }

  function broadcast(task, force) {
    const now = Date.now();
    if (!force && task._lastPush && now - task._lastPush < C.TASK.PROGRESS_BROADCAST_MS) return;
    task._lastPush = now;
    notify({ type: C.MSG.TASK_EVENT, task: publicTask(task) });
  }

  function publicTask(task) {
    return {
      id: task.id, createdAt: task.createdAt, updatedAt: task.updatedAt,
      status: task.status, pageUrl: task.pageUrl, tabId: task.tabId,
      albumId: task.albumId, albumName: task.albumName, albumMode: task.albumMode,
      total: task.total, counts: Object.assign({}, task.counts),
      items: task.items.slice(0, 500).map((it) => ({
        id: it.id, url: it.url, thumbUrl: it.url, fileName: it.fileName, status: it.status,
        progress: it.progress, errorCode: it.errorCode || '', errorMessage: it.errorMessage || '',
        retryCount: it.retryCount, mediaItemId: it.mediaItemId || '',
        productUrl: it.productUrl || '', isDuplicate: !!it.isDuplicate
      })),
      finishedAt: task.finishedAt || null
    };
  }

  /* ---------------- 辅助 ---------------- */

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function fileNameFromUrl(url) {
    try {
      const u = new URL(url);
      const base = decodeURIComponent(u.pathname.split('/').pop() || '').trim();
      if (!base) return '';
      return U.sanitizeFileName(base, '');
    } catch (e) { return ''; }
  }

  const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif', 'image/heic': 'heic', 'image/bmp': 'bmp' };

  function ensureExt(name, mime) {
    const ext = EXT_BY_MIME[mime];
    if (!ext) return name;
    const m = /\.([a-z0-9]{2,5})$/i.exec(name);
    return m ? name : (name + '.' + ext);
  }

  function countByStatus(task) {
    const c = { succeeded: 0, failed: 0, skipped: 0, cancelled: 0 };
    for (const it of task.items) {
      if (it.status === 'success') c.succeeded++;
      else if (it.status === 'failed') c.failed++;
      else if (it.status === 'skipped') c.skipped++;
      else if (it.status === 'cancelled') c.cancelled++;
    }
    task.counts = c;
  }

  function nextQueued(task) {
    const now = Date.now();
    for (const it of task.items) {
      if (it.status === 'queued' && (!it.retryAt || now >= it.retryAt)) return it;
    }
    return null;
  }

  function hasQueued(task) {
    const now = Date.now();
    return task.items.some((it) => it.status === 'queued' && (!it.retryAt || now >= it.retryAt));
  }

  /* ---------------- 相册解析 ---------------- */

  async function resolveAlbum(task, pageUrl) {
    const settings = await Store.getSettings();
    const authCfg = (settings.auth || {});
    const template = authCfg.albumNameTemplate || C.TASK.ALBUM_NAME_TEMPLATE;

    if (task.albumMode === 'none') { task.albumId = ''; task.albumName = ''; return; }
    if (task.albumMode === 'select') {
      // albumId 由前端传入（本插件创建过的相册）
      if (!task.albumId) task.albumMode = 'auto';
      return;
    }
    let title = '';
    if (task.albumMode === 'named') title = (settings.albumName || '').trim() || U.renderAlbumTemplate(template, pageUrl);
    else title = (task.albumName || '').trim() || U.renderAlbumTemplate(template, pageUrl); // auto：可选自定义名称
    task.albumName = title;
    const r = await Photos.createAlbum(async (interactive, force) => PGX.Auth.ensureToken(interactive, force), title);
    if (r.ok) { task.albumId = r.album.id; task.albumName = r.album.title || title; }
    else throw Object.assign(new Error(r.error && r.error.message), { code: r.error && r.error.code, ok: false });
  }

  /* ---------------- 批量 batchCreate 聚合 ---------------- */

  function enqueueBatch(task, item, uploadToken) {
    let bucket = mem.buckets.get(task.id);
    if (!bucket) {
      bucket = { albumId: task.albumId || '', tokens: [], items: [] };
      mem.buckets.set(task.id, bucket);
    }
    bucket.tokens.push({ item, uploadToken });
    if (bucket.tokens.length >= 50) { clearTimeout(mem.bucketTimers.get(task.id)); mem.bucketTimers.delete(task.id); return flushBucket(task.id); }
    if (!mem.bucketTimers.has(task.id)) {
      const timer = setTimeout(() => { mem.bucketTimers.delete(task.id); flushBucket(task.id); }, 2500);
      mem.bucketTimers.set(task.id, timer);
    }
    return Promise.resolve();
  }

  async function flushBucket(taskId) {
    const bucket = mem.buckets.get(taskId);
    const task = mem.tasks.get(taskId);
    if (!bucket || !bucket.tokens.length || !task) return;
    const tokens = bucket.tokens;
    bucket.tokens = [];
    if (task.status !== 'running' && task.status !== 'queued' && task.status !== 'paused') {
      // 任务已终止：把剩余 token 标记取消
      for (const { item } of tokens) finishItem(task, item, { status: 'cancelled' });
      return;
    }
    const r = await Photos.batchCreate(async (i, force) => PGX.Auth.ensureToken(i, force), tokens.map((t) => ({
      uploadToken: t.uploadToken, fileName: t.item.uploadName || 'image.jpg'
    })), bucket.albumId);
    if (!r.ok) {
      // 整批失败：逐个按其错误码进入重试/失败逻辑
      for (const { item } of tokens) failOrRetry(task, item, r.error && r.error.code, r.error && r.error.message);
      countByStatus(task); scheduleSave(); broadcast(task, true);
      return;
    }
    for (let i = 0; i < r.results.length && i < tokens.length; i++) {
      const res = r.results[i];
      const item = tokens[i].item;
      if (res.error) failOrRetry(task, item, res.error.code, res.error.message);
      else {
        item.status = 'success'; item.progress = 100;
        item.mediaItemId = res.mediaItemId || ''; item.productUrl = res.productUrl || '';
        if (item.hash) Store.addHash(item.hash, res.mediaItemId).catch(() => null);
      }
    }
    countByStatus(task);
    scheduleSave();
    broadcast(task, false);
  }

  /* ---------------- 条目失败/重试 ---------------- */

  function failOrRetry(task, item, code, message) {
    const settingsCache = Uploads._settings || {};
    const maxRetries = (settingsCache.retries !== undefined ? settingsCache.retries : C.TASK.DEFAULT_RETRIES);
    code = code || C.ERR.SERVER;
    if (RETRIABLE.has(code) && item.retryCount < maxRetries && !task._cancelRequested) {
      item.status = 'queued';
      item.retryAt = Date.now() + U.backoffMs(item.retryCount);
      item.retryCount++;
      item.errorCode = code;
      item.errorMessage = message || C.ERROR_TEXT[code] || '';
      item.progress = 0;
      return;
    }
    finishItem(task, item, { status: 'failed', errorCode: code, errorMessage: message || C.ERROR_TEXT[code] || '' });
  }

  function finishItem(task, item, patch) {
    Object.assign(item, patch);
    if (item.status === 'success') item.progress = 100;
    else if (item.status === 'cancelled' || item.status === 'failed') item.progress = item.progress || 0;
  }

  /* ---------------- 单条处理管线 ---------------- */

  async function processItem(task, item) {
    mem.lastActivity = Date.now();
    item.status = 'downloading';
    item.progress = 5;
    scheduleSave();
    broadcast(task, false);

    const dl = await Downloader.download(item.url, task.tabId, {
      fileLimitMB: Uploads._settings.singleFileLimitMB,
      referrer: task.pageUrl || ''
    });

    if (task._cancelRequested || task.status === 'cancelled') {
      finishItem(task, item, { status: 'cancelled' });
      countByStatus(task); scheduleSave(); broadcast(task, false);
      return;
    }
    if (!dl.ok) {
      // 图片源站返回 401/403 属于图片下载权限问题，不是 Google 账号授权失效。
      if (dl.status === 401 || dl.status === 403) {
        finishItem(task, item, { status: 'failed', errorCode: C.ERR.HTTP, errorMessage: `图片源站拒绝访问（HTTP ${dl.status}），请确认当前页面可正常打开原图` });
        countByStatus(task); scheduleSave(); broadcast(task, false);
        return;
      }
      failOrRetry(task, item, dl.code, dl.message);
      countByStatus(task); scheduleSave(); broadcast(task, false);
      return;
    }

    // 去重
    item.hash = await sha256Hex(dl.bytes).catch(() => '');
    if (item.hash && Uploads._settings.skipDuplicates) {
      if (await Store.hasHash(item.hash).catch(() => false)) {
        finishItem(task, item, { status: 'skipped', errorCode: C.ERR.DUPLICATE, errorMessage: C.ERROR_TEXT[C.ERR.DUPLICATE], isDuplicate: true });
        countByStatus(task); scheduleSave(); broadcast(task, false);
        return;
      }
    }

    // 上传字节
    item.status = 'uploading';
    item.progress = 40;
    broadcast(task, false);
    const base = item.fileName || fileNameFromUrl(item.url) || U.defaultFileName('');
    const nameNoExt = base.replace(/\.[a-z0-9]{2,5}$/i, '') || 'image';
    const mime2 = dl.mime;
    item.uploadName = ensureExt(nameNoExt + '_' + task.id.slice(-4), mime2) || (nameNoExt + '.jpg');
    const up = await Photos.uploadBytes(async (i, force) => PGX.Auth.ensureToken(i, force), dl.bytes, item.uploadName, mime2);
    if (!up.ok) {
      // 401 授权失效：暂停任务等待重新授权，避免死循环
      if (up.error && up.error.code === C.ERR.AUTH_EXPIRED) {
        task.status = 'paused';
        task._authPaused = true;
        item.errorCode = C.ERR.AUTH_EXPIRED;
        item.errorMessage = C.ERROR_TEXT[C.ERR.AUTH_EXPIRED];
        item.progress = 0;
        countByStatus(task); scheduleSave(); broadcast(task, true);
        notify({ type: C.MSG.AUTH_REQUIRED, reason: '上传过程中授权失效', taskId: task.id });
        return;
      }
      failOrRetry(task, item, up.error && up.error.code, up.error && up.error.message);
      countByStatus(task); scheduleSave(); broadcast(task, false);
      return;
    }
    item.progress = 80;
    scheduleSave();
    broadcast(task, false);
    await enqueueBatch(task, item, up.uploadToken);
  }

  /* ---------------- 任务调度 ---------------- */

  function taskTerminalStatus(task) {
    const nonTerminal = task.items.some((it) => !['success', 'failed', 'skipped', 'cancelled'].includes(it.status));
    if (nonTerminal) return null;
    if (task._cancelRequested || task.status === 'cancelled') return 'cancelled';
    if (task.counts.succeeded + task.counts.skipped === 0 && task.counts.failed > 0) return 'failed';
    return 'completed';
  }

  function kick(task) {
    const id = task.id;
    mem.lastActivity = Date.now();
    if (mem.stopped.has(id)) return;
    if (task.status !== 'running') return;
    const inflight = mem.inflight.get(id) || 0;
    const concurrency = U.clamp(Uploads._settings.maxConcurrent, 1, C.TASK.MAX_CONCURRENCY);
    while ((mem.inflight.get(id) || 0) < concurrency) {
      if (task.status !== 'running' || mem.stopped.has(id)) break;
      const item = nextQueued(task);
      if (!item) break;
      mem.inflight.set(id, (mem.inflight.get(id) || 0) + 1);
      processItem(task, item)
        .catch((e) => {
          finishItem(task, item, { status: 'failed', errorCode: C.ERR.SERVER, errorMessage: String((e && e.message) || '内部错误') });
          countByStatus(task); scheduleSave(); broadcast(task, false);
        })
        .finally(() => {
          const c = (mem.inflight.get(id) || 1) - 1;
          mem.inflight.set(id, Math.max(0, c));
          scheduleSave();
          broadcast(task, false);
          settleCheck(task);
        });
    }
    settleCheck(task);
  }

  function settleCheck(task) {
    if (mem.stopped.has(task.id)) return;
    const inflight = mem.inflight.get(task.id) || 0;
    if (inflight > 0) return;
    // 有可执行条目 -> 继续；有待重试条目（未来时刻）-> 定时；否则终态
    if (task.status === 'running') {
      if (hasQueued(task)) { kick(task); return; }
      const futureQueued = task.items.some((it) => it.status === 'queued' && it.retryAt && it.retryAt > Date.now());
      if (futureQueued) {
        const earliest = Math.min(...task.items.filter((it) => it.status === 'queued' && it.retryAt).map((it) => it.retryAt));
        setTimeout(() => settleCheck(task), Math.max(500, earliest - Date.now()));
        return;
      }
    }
    // 桶内残留（paused/结束）也要尝试一次 flush
    const bucket = mem.buckets.get(task.id);
    if (bucket && bucket.tokens.length && task.status === 'running') { flushBucket(task.id); return; }

    const terminal = taskTerminalStatus(task);
    if (terminal) finalizeTask(task, terminal);
    else if (task.status === 'paused') {
      // 停顿状态：无 inflight，保持 paused
    } else if (task.status === 'cancelled') {
      finalizeTask(task, 'cancelled');
    }
  }

  /* 结算收费额度：任务成功(有成功项) -> commit 确认；任务取消/失败且无成功项 -> release 退回。
   * commit 不返额；release 返额。仅当任务携带 billing 预扣信息时才结算。 */
  async function settleBilling(task, terminal) {
    const billing = task.billing;
    if (!billing || !billing.reservation) return;
    if (typeof Billing === 'undefined' || !Billing) return;
    try {
      const succeeded = task.counts.succeeded > 0;
      const shouldCommit = terminal === 'completed' && succeeded;
      const shouldRelease = terminal === 'cancelled' || terminal === 'failed' || !succeeded;
      let op = 'upload';
      if (shouldCommit) await Billing.commit(op, billing.reservation);
      else if (shouldRelease) await Billing.release(op, billing.reservation);
    } catch (e) {
      // 结算失败不影响本地状态，忽略
    }
  }

  async function finalizeTask(task, terminal) {
    if (mem.tasks.get(task.id) !== task) return;
    task.status = terminal;
    task.finishedAt = U.now();
    countByStatus(task);
    mem.stopped.add(task.id);
    mem.buckets.delete(task.id);
    clearTimeout(mem.bucketTimers.get(task.id));
    mem.bucketTimers.delete(task.id);
    const historyEntry = makeHistoryEntry(task);
    if (Uploads._settings.keepHistory) Store.pushHistory(historyEntry, Uploads._settings.historyDays).catch(() => null);
    await settleBilling(task, terminal);
    await persistNow();
    mem.tasks.delete(task.id);
    mem.inflight.delete(task.id);
    broadcast(task, true);
    notify({ type: 'task_finished', taskId: task.id, status: terminal });
  }

  function makeHistoryEntry(task) {
    return {
      id: task.id, createdAt: task.createdAt, finishedAt: task.finishedAt,
      status: task.status, pageUrl: task.pageUrl, albumName: task.albumName || '',
      total: task.total, counts: Object.assign({}, task.counts),
      failedItems: task.items.filter((it) => it.status === 'failed').map((it) => ({
        url: it.url, fileName: it.fileName || '', width: it.width || 0, height: it.height || 0,
        errorCode: it.errorCode || '', errorMessage: it.errorMessage || ''
      })).slice(0, 200),
      items: task.items.slice(0, 200).map((it) => ({ url: it.url, status: it.status, fileName: it.fileName || '' }))
    };
  }

  /* ---------------- 对外 API ---------------- */

  const Uploads = {
    setNotifier(fn) { mem.notify = fn; },

    async init() {
      const map = await Store.getTasksMap();
      const settings = await Store.getSettings();
      Uploads._settings = settings;
      for (const [id, t] of Object.entries(map)) mem.tasks.set(id, t);
    },

    /** SW 重启后恢复：running 任务置回 running，飞行中条目回到 queued 重新下载。
     *  SW 仍存活（近期有调度活动）时跳过，避免把在飞任务重置造成重复上传。 */
    async restore() {
      const settings = await Store.getSettings();
      Uploads._settings = settings;
      if (mem.lastActivity && Date.now() - mem.lastActivity < 5000) return 0;
      let resumed = 0;
      for (const [id, task] of mem.tasks) {
        if (task.status === 'running' || task.status === 'queued') {
          task.status = 'running';
          task._cancelRequested = false;
          for (const it of task.items) {
            if (it.status === 'downloading' || it.status === 'uploading') {
              it.status = 'queued'; it.progress = 0; it.retryAt = undefined;
            }
          }
          mem.stopped.delete(id);
          kick(task);
          resumed++;
        }
      }
      return resumed;
    },

    async refreshSettings() {
      const settings = await Store.getSettings();
      Uploads._settings = settings;
      return settings;
    },

    getActive() {
      const out = [];
      for (const t of mem.tasks.values()) out.push(publicTask(t));
      return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    getTask(taskId) {
      const t = mem.tasks.get(taskId);
      return t ? publicTask(t) : null;
    },

    /**
     * 创建并启动上传任务
     * payload: { items:[{url,fileName,width,height,pageUrl}], albumMode, albumId?, albumName?, tabId?, pageUrl, billing? }
     */
    async createTask(payload) {
      const settings = await Uploads.refreshSettings();
      const maxBatch = settings.maxBatch || C.TASK.MAX_BATCH;
      const items = (payload.items || []).slice(0, maxBatch).map((it) => ({
        id: U.id(), url: it.url, fileName: (it.fileName && U.sanitizeFileName(it.fileName, '')) || fileNameFromUrl(it.url) || '',
        width: it.width || 0, height: it.height || 0, status: 'queued', progress: 0,
        retryCount: 0, errorCode: '', errorMessage: '', mediaItemId: '', productUrl: '', hash: ''
      }));
      if (!items.length) throw new Error('没有可上传的图片');
      const task = {
        id: U.id(), createdAt: U.now(), updatedAt: U.now(), status: 'queued',
        pageUrl: payload.pageUrl || '', tabId: payload.tabId || null,
        albumMode: payload.albumMode || 'auto',
        albumId: payload.albumId || '', albumName: payload.albumName || '',
        total: items.length, counts: { succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
        items, startedAt: null, finishedAt: null, _cancelRequested: false,
        billing: payload.billing || null   // { reservation, operation, period }
      };
      mem.stopped.delete(task.id);
      mem.tasks.set(task.id, task);
      await resolveAlbum(task, payload.pageUrl || '');
      task.status = 'running';
      task.startedAt = U.now();
      await persistNow();
      broadcast(task, true);
      kick(task);
      return task.id;
    },

    cancelTask(taskId) {
      const task = mem.tasks.get(taskId);
      if (!task) return false;
      task._cancelRequested = true;
      task.status = 'cancelled';
      for (const it of task.items) {
        if (it.status === 'queued') { it.status = 'cancelled'; it.progress = 0; }
      }
      countByStatus(task);
      scheduleSave();
      broadcast(task, true);
      settleCheck(task);
      return true;
    },

    pauseTask(taskId) {
      const task = mem.tasks.get(taskId);
      if (!task || task.status !== 'running') return false;
      task.status = 'paused';
      scheduleSave();
      broadcast(task, true);
      return true;
    },

    resumeTask(taskId) {
      const task = mem.tasks.get(taskId);
      if (!task || task.status !== 'paused') return false;
      task._cancelRequested = false;
      task._authPaused = false;
      task.status = 'running';
      mem.stopped.delete(task.id);
      scheduleSave();
      broadcast(task, true);
      kick(task);
      return true;
    },

    /** 登录成功/换号后自动恢复因授权失效而暂停的任务 */
    resumeAuthPaused() {
      let n = 0;
      for (const task of mem.tasks.values()) {
        if (task.status === 'paused' && task._authPaused) {
          task._authPaused = false;
          task.status = 'running';
          mem.stopped.delete(task.id);
          scheduleSave();
          broadcast(task, true);
          kick(task);
          n++;
        }
      }
      return n;
    },

    /** 单项重试：仅对失败/跳过的条目 */
    retryItem(taskId, itemId) {
      const task = mem.tasks.get(taskId);
      if (!task || task.status === 'completed') return false;
      const it = task.items.find((x) => x.id === itemId);
      if (!it || !['failed', 'skipped', 'cancelled'].includes(it.status)) return false;
      it.status = 'queued'; it.progress = 0; it.retryAt = undefined; it.errorCode = ''; it.errorMessage = '';
      it.retryCount = 0;
      if (task.status !== 'running') {
        task.status = 'running'; mem.stopped.delete(task.id);
        if (!task.startedAt) task.startedAt = U.now();
      }
      countByStatus(task);
      scheduleSave();
      broadcast(task, true);
      kick(task);
      return true;
    },

    retryFailed(taskId) {
      const task = mem.tasks.get(taskId);
      if (!task) return false;
      let any = false;
      for (const it of task.items) {
        if (it.status === 'failed') {
          it.status = 'queued'; it.progress = 0; it.retryAt = undefined;
          it.errorCode = ''; it.errorMessage = ''; it.retryCount = 0;
          any = true;
        }
      }
      if (!any) return false;
      if (task.status !== 'running') { task.status = 'running'; mem.stopped.delete(task.id); }
      countByStatus(task);
      scheduleSave();
      broadcast(task, true);
      kick(task);
      return true;
    },

    /** 从历史记录重建任务（上传失败项） */
    async retryFromHistory(entryId) {
      const history = await Store.getHistory();
      const entry = history.find((h) => h.id === entryId);
      if (!entry || !entry.failedItems || !entry.failedItems.length) throw new Error('没有可重试的失败项');
      const taskId = await Uploads.createTask({
        items: entry.failedItems.map((f) => ({ url: f.url, fileName: f.fileName, width: f.width, height: f.height })),
        albumMode: 'auto', pageUrl: entry.pageUrl, albumName: entry.albumName
      });
      return taskId;
    }
  };

  PGX.Uploads = Uploads;
})();
