/* Popup 主逻辑：图片选择 / 上传任务 / 历史记录 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const send = (msg) => new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) resolve({ ok: false, message: chrome.runtime.lastError.message });
      else resolve(resp);
    });
  });

  /* ---------- 小工具 ---------- */
  function fmtBytes(n) {
    if (!n || !isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB']; let v = n;
    for (let i = -1; i < u.length; i++) {
      if (v < 1024 || i === u.length - 1) return (i < 0 ? v + ' B' : v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[i]);
      v /= 1024;
    }
  }
  function domainOf(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }
  function baseName(url) {
    try {
      const u = new URL(url);
      return decodeURIComponent(u.pathname.split('/').pop() || '') || domainOf(url) || 'image';
    } catch (e) { return 'image'; }
  }
  function fmtClock(iso) { const d = new Date(iso); const p = (x) => String(x).padStart(2, '0'); return `${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  function toast(text, isErr) {
    const t = $('toast');
    t.textContent = text; t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.add('hidden'), 2800);
  }
  const STATUS_TEXT = {
    queued: '排队中', downloading: '下载中', uploading: '上传中', success: '成功',
    failed: '失败', skipped: '已跳过', cancelled: '已取消',
    running: '进行中', paused: '已暂停', completed: '已完成', cancelledTask: '已取消'
  };
  const TAG_CLASS = { success: 'success', failed: 'failed', skipped: 'skipped', cancelled: 'cancelled',
    queued: 'queued', downloading: 'downloading', uploading: 'uploading', running: 'running',
    paused: 'paused', completed: 'completed', failedTask: 'failed', cancelledTask: 'cancelled' };

  /* ---------- 状态 ---------- */
  const state = {
    view: 'images',
    auth: null,
    settings: null,
    tabId: null,
    scan: null,          // { candidates, truncated, pageUrl, ts }
    chosen: new Map(),   // recId -> 手动选择的候选 url
    sel: new Set(),      // recId
    // 默认只显示内容图，头像/图标/广告等装饰资源需用户主动切换“全部图片”查看。
    filter: 'content', sort: 'page', search: '',
    layout: 'grid',      // 默认卡片/网格视图（大缩略图，每行2张）；可切列表
    thumbMode: 'cover',
    hostPerm: false,     // 是否已获「所有网站」下载权限（决定缩略图是否走后台代理）
    _thumbCache: null,   // 缩略图 dataURL 缓存（防重复抓取）
    tasks: [], activeTaskId: null,
    history: [],
    albums: []                    // 本插件创建（或可写）的相册列表
  };

  /* ---------- 初始化 ---------- */
  async function boot() {
    // 与 Service Worker 建立长连接，接收实时事件
    const syncPort = chrome.runtime.connect({ name: 'popup-sync' });
    syncPort.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'task_event') onTaskEvent(msg.task);
      else if (msg.type === 'task_finished') onTaskFinished(msg.taskId, msg.status);
      else if (msg.type === 'auth_changed') refreshAuth();
      else if (msg.type === 'auth_required') onAuthRequired(msg.reason, msg.taskId);
      else if (msg.type === 'scan_event') onScanEvent(msg.tabId, msg.additions);
      else if (msg.type === 'quota_changed') refreshBilling();
    });
    bindUi();

    const r = await send({ type: 'get_init' });
    if (!r || !r.ok) { toast('初始化失败', true); return; }
    state.auth = r.auth; state.settings = r.settings; state.tabId = r.tabId;
    state.tasks = r.tasks || [];
    renderAuth();
    renderMockBadge();
    updateTaskBadge();
    updateAlbumHint();
    bindAccount();
    bindBilling();
    initLayout(); // 同步视图切换按钮状态
    // 预取本插件创建的相册列表（供底部「加入指定相册」使用；需已登录）
    if (state.auth && state.auth.connected && !state.auth.useMock) loadExistingAlbums(false);
    // 初始化会员/额度栏
    refreshBilling();
    // 公告/维护横幅
    loadAnnouncement();

    if (r.scan && Array.isArray(r.scan.candidates) && r.scan.candidates.length) {
      state.scan = r.scan;
      applyScan();
    } else {
      doScan(true);
    }

    // 打开弹窗属于用户手势，借此引导授予「所有网站」下载权限（最可靠，能绕过跨域/防盗链）。
    // 先读当前授权态，决定缩略图是否走后台代理；仅当未授权且未在本次会话请求过时触发一次申请。
    state.hostPerm = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
    if (state.auth && state.auth.connected && !state.hostPerm && !state._hostPermAsked) {
      state._hostPermAsked = true;
      ensureHostPerms();
    } else if (state.hostPerm && state.scan && state.scan.candidates && state.scan.candidates.length) {
      renderList(); // 已授权且已有扫描结果：刷新让缩略图走后台代理
    }
  }

  /* ---------- UI 事件绑定 ---------- */
  function bindUi() {
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.tab)));
    $('btn-scan').addEventListener('click', () => doScan(true));
    $('sel-filter').addEventListener('change', (e) => { state.filter = e.target.value; e.target.dataset.userSet = '1'; renderList(); });
    $('sel-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
    $('inp-search').addEventListener('input', debounce((e) => { state.search = e.target.value.trim().toLowerCase(); renderList(); }, 220));
    document.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => onBulkSelect(b.dataset.sel)));
    const vl = $('view-btn-list'), vg = $('view-btn-grid');
    if (vl) vl.addEventListener('click', () => setLayout('list'));
    if (vg) vg.addEventListener('click', () => setLayout('grid'));
    const tc = $('thumb-mode-cover'), tf = $('thumb-mode-contain');
    if (tc) tc.addEventListener('click', () => setThumbMode('cover'));
    if (tf) tf.addEventListener('click', () => setThumbMode('contain'));
    $('btn-upload').addEventListener('click', () => uploadSelected([...state.sel]));
    $('btn-upload-one').addEventListener('click', () => downloadSelected([...state.sel]));
    $('btn-download-zip').addEventListener('click', () => downloadSelectedZip([...state.sel]));
    $('album-target').addEventListener('change', (e) => {
      const v = e.target.value;
      if (state.settings) {
        state.settings.albumMode = v;
        // 持久化目标设置，避免关闭弹窗后丢失
        send({ type: 'save_settings', settings: state.settings });
      }
      updateAlbumHint();
      // 切到「加入指定相册」时触发展开已有相册列表
      if (v === 'select') loadExistingAlbums(true);
    });
    const aan = $('album-auto-name');
    if (aan) aan.addEventListener('input', debounce(() => {
      if (!state.settings) return;
      state.settings.autoAlbumName = aan.value.trim();
      send({ type: 'save_settings', settings: state.settings });
      updateAlbumHint();
    }, 260));
    $('album-pick').addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10);
      const a = state.albums[idx];
      if (state.settings && a) {
        state.settings.albumMode = 'select';
        state.settings.albumId = a.id;
        state.settings.albumName = a.title;
        // 持久化所选相册，避免关闭弹窗后丢失
        send({ type: 'save_settings', settings: state.settings });
      }
      updateAlbumHint();
    });
    const rb = $('btn-refresh-albums');
    if (rb) rb.addEventListener('click', () => loadExistingAlbums(true));
    $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('btn-auth-warning').addEventListener('click', () => loginFlow());

    $('btn-pause').addEventListener('click', () => taskCtrl('pause_task'));
    $('btn-resume').addEventListener('click', () => taskCtrl('resume_task'));
    $('btn-cancel').addEventListener('click', () => taskCtrl('cancel_task'));
    $('btn-retry-failed').addEventListener('click', () => taskCtrl('retry_failed'));
    $('btn-clear-completed').addEventListener('click', () => clearTasks('completed'));
    $('btn-clear-failed').addEventListener('click', () => clearTasks('failed'));
    $('btn-clear-history').addEventListener('click', clearHistory);
    $('preview-close').addEventListener('click', closePreview);
    $('preview-max').addEventListener('click', togglePreviewMax);
    $('preview-prev').addEventListener('click', () => stepPreview(-1));
    $('preview-next').addEventListener('click', () => stepPreview(1));
    $('preview-play').addEventListener('click', togglePreviewPlay);
    $('image-preview').addEventListener('click', (e) => { if (e.target.id === 'image-preview') closePreview(); });
    document.addEventListener('keydown', (e) => { if ($('image-preview').classList.contains('hidden')) return; if (e.key === 'Escape') closePreview(); else if (e.key === 'ArrowLeft') stepPreview(-1); else if (e.key === 'ArrowRight') stepPreview(1); });
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  let previewList = [], previewPos = 0, previewTimer = null;
  function openPreview(rec) { previewList = visibleRecs(); previewPos = Math.max(0, previewList.findIndex((x) => x.id === rec.id)); $('image-preview').classList.remove('hidden'); renderPreview(); }
  function renderPreview() { const rec = previewList[previewPos]; if (!rec) return; $('preview-image').src = chosenUrl(rec); $('preview-index').textContent = `${previewPos + 1} / ${previewList.length}`; }
  function stepPreview(delta) { if (!previewList.length) return; previewPos = (previewPos + delta + previewList.length) % previewList.length; renderPreview(); }
  function closePreview() { $('image-preview').classList.add('hidden'); if (previewTimer) { clearInterval(previewTimer); previewTimer = null; } $('preview-play').textContent = '▶ 自动播放'; }
  async function togglePreviewMax() {
    const rec = previewList[previewPos]; if (!rec) return;
    const r = await send({ type: 'open_full_preview', url: chosenUrl(rec), urls: previewList.map((x) => chosenUrl(x)), index: previewPos });
    if (!r || !r.ok) toast('无法打开全屏预览', true);
  }
  function togglePreviewPlay() { if (previewTimer) { clearInterval(previewTimer); previewTimer = null; $('preview-play').textContent = '▶ 自动播放'; } else { previewTimer = setInterval(() => stepPreview(1), 3000); $('preview-play').textContent = '⏸ 停止播放'; } }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === view));
    ['images', 'tasks', 'history'].forEach((v) => $('view-' + v).classList.toggle('hidden', v !== view));
    if (view === 'images') renderList();
    if (view === 'tasks') { loadTasks().then(renderTaskView); }
    if (view === 'history') loadHistory();
  }

  /* ---------- 扫描 ---------- */
  async function doScan(force) {
    const btn = $('btn-scan');
    const msgEl = $('scan-msg');
    const autoScroll = !!(state.settings && state.settings.autoScroll);
    msgEl.textContent = autoScroll ? '正在自动滚动扫描全页（触发懒加载）…' : '正在扫描页面图片…';
    btn.disabled = true;
    const r = await send({ type: 'scan_tab', tabId: state.tabId, force });
    btn.disabled = false;
    if (!r || !r.ok) {
      msgEl.textContent = (r && r.message) || '扫描失败';
      return;
    }
    state.scan = r.snapshot;
    applyScan();
  }

  function applyScan() {
    // 默认筛选：始终显示「全部图片」作为默认，避免内容图筛选把大部分图隐藏导致列表空白；
    // 用户可手动切换「内容图」等筛选（isDecor 仅作标记，不默认隐藏）。
    if (!$('sel-filter').dataset.userSet) {
      state.filter = 'content';
      $('sel-filter').value = 'content';
    }
    renderList();
    const meta = $('scan-meta');
    const s = state.scan;
    meta.textContent = s ? `${s.candidates.length} 张${s.truncated ? '（已截断）' : ''} · ${s.pageUrl ? domainOf(s.pageUrl) : ''} · ${Math.round((s.scanMs || 0))}ms` : '';
    $('scan-msg').textContent = s && s.candidates.length ? '扫描完成，勾选后上传' : '未发现可上传的图片';
    updateUploadButtons();
    // 诊断：输出真实数量与可见数量，便于定位列表空白
    try {
      const n = (s && s.candidates) ? s.candidates.length : 0;
      const nId = (s && s.candidates) ? s.candidates.filter((c) => c && c.id).length : 0;
      console.log('[PGX-debug] scan candidates=', n, 'with id=', nId, 'visible=', visibleRecs().length, 'filter=', state.filter);
    } catch (e) { /* noop */ }
  }

  function onScanEvent(tabId, additions) {
    if (!additions || !additions.length) return;
    if (!state.scan) { state.scan = { candidates: [], truncated: false, pageUrl: '', scanMs: 0, ts: Date.now() }; }
    // 若 tabId 不匹配当前，仍合并进列表（避免因 popup 重新打开导致 activeTab 变化而丢数据）
    state.scan.candidates = state.scan.candidates.concat(additions).slice(0, 1500);
    state.scan.pageUrl = state.scan.pageUrl || (additions[0] && additions[0].pageUrl) || '';
    $('scan-msg').textContent = `扫描完成，共 ${state.scan.candidates.length} 张`;
    applyScan();
  }

  /* ---------- 列表渲染 ---------- */
  function visibleRecs() {
    let list = Array.isArray(state.scan && state.scan.candidates) ? state.scan.candidates.filter((c) => c && typeof c === 'object') : [];
    const q = state.search;
    if (q) list = list.filter((c) => {
      const hay = ((c.srcUrl || '') + ' ' + (c.ext || '') + ' ' + domainOf(c.srcUrl) + ' ' + (c.decorReason || '')).toLowerCase();
      return hay.includes(q);
    });
    if (state.filter === 'content') list = list.filter((c) => !c.isDecor && !c.isLikelyThumb);
    else if (state.filter === 'hd') list = list.filter((c) => !c.isDuplicate && !c.isLikelyThumb && c.isLikelyOriginal && c.width * c.height > 0);
    else if (state.filter === 'thumb') list = list.filter((c) => c.isLikelyThumb);
    else if (state.filter === 'dup') list = list.filter((c) => c.isDuplicate);
    else if (state.filter === 'decor') list = list.filter((c) => c.isDecor);
    if (state.sort === 'res-desc' || state.sort === 'res-asc') {
      const f = (c) => (c.width || 0) * (c.height || 0);
      list = [...list].sort((a, b) => (state.sort === 'res-desc' ? f(b) - f(a) : f(a) - f(b)));
    }
    return list;
  }

  function thumbOf(rec) {
    // 缩略图优先用元素实际渲染的小图；没有则用主地址
    const candidates = Array.isArray(rec.candidates) ? rec.candidates : [];
    const small = candidates.find((c) => c && c.source === 'src') || candidates[0];
    return (small && small.url) || rec.srcUrl || '';
  }

  // 若已获「所有网站」权限，则请后台抓取缩略图并以 dataURL 返回（解决防盗链图片列表显示为空白/裂图）
  async function proxiedThumbUrl(rec) {
    const turl = thumbOf(rec);
    if (!turl) return '';
    // 与成熟批量下载器类似：渲染缩略图时即尝试缓存可读取的图片数据，ZIP 可直接复用。
    const cacheKey = 'thumb:' + turl;
    if (state._thumbCache && state._thumbCache[cacheKey]) return state._thumbCache[cacheKey];
    const r = await send({ type: 'proxy_thumb', url: turl, tabId: state.tabId, referrer: (state.scan && state.scan.pageUrl) || '' });
    if (r && r.ok && r.dataUrl) {
      if (!state._thumbCache) state._thumbCache = {};
      state._thumbCache[cacheKey] = r.dataUrl;
      return r.dataUrl;
    }
    return turl; // 抓取失败则退回原始地址（可能裂图，但至少不阻塞）
  }

  function initLayout() {
    const vl = $('view-btn-list'), vg = $('view-btn-grid');
    if (vl) vl.classList.toggle('active', state.layout === 'list');
    if (vg) vg.classList.toggle('active', state.layout === 'grid');
  }

  function setLayout(mode) {
    state.layout = (mode === 'grid') ? 'grid' : 'list';
    initLayout();
    renderList();
  }
  function setThumbMode(mode) {
    state.thumbMode = mode === 'contain' ? 'contain' : 'cover';
    $('thumb-mode-cover')?.classList.toggle('active', state.thumbMode === 'cover');
    $('thumb-mode-contain')?.classList.toggle('active', state.thumbMode === 'contain');
    renderList();
  }

  function renderList() {
    const listEl = $('img-list');
    listEl.innerHTML = '';
    const recs = visibleRecs();
    // 应用布局类（grid 为每行2张的大缩略图网格）
    listEl.className = 'img-list ' + (state.layout === 'grid' ? 'view-grid' : 'view-list');
    $('img-empty').classList.toggle('hidden', recs.length > 0);

    let io = null;
    try { io = ('IntersectionObserver' in window)
      ? new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            const img = en.target;
            io.unobserve(img);
            // 懒加载原图地址；若有主机权限则改走后台代理 dataURL
            if (img.dataset.src && !img.src) {
              if (!state.hostPerm) img.src = img.dataset.src;
              else {
                const rec = img._rec;
                if (rec && !img.dataset.proxied) {
                  img.dataset.proxied = '1';
                  proxiedThumbUrl(rec).then((u) => { if (u && u !== img.src) img.src = u; });
                }
              }
            }
          }
        }
      }, { root: null, rootMargin: '200px' }) : null;
    } catch (e) {
      // 某些 Chromium 弹窗环境不允许以未挂载列表作为 root，禁用观察器并走直接加载。
      io = null;
    }

    let rendered = 0;
    let failed = 0;
    for (const rec of recs) {
      try {
        listEl.appendChild(buildRow(rec, io));
        rendered++;
      } catch (e) {
        failed++;
        // 单条记录异常不再静默跳过：保留可勾选的降级行，避免用户看到空白内容区。
        console.warn('[PGX] renderRow 异常:', e && e.message, rec && rec.id);
        const fallback = document.createElement('li');
        fallback.className = 'img-item';
        fallback.textContent = ((rec && rec.srcUrl) || '图片记录') + '（渲染失败：' + String((e && e.message) || '未知错误') + '）';
        listEl.appendChild(fallback);
      }
    }
    if (failed) console.warn(`[PGX-debug] 渲染失败 ${failed} 条（已跳过），成功 ${rendered} 条`);
    // 列表为空时给出更明确的提示（区分「无图」与「被筛选隐藏」）
    if (!recs.length && state.scan && state.scan.candidates && state.scan.candidates.length) {
      $('img-empty').textContent = '扫描到 ' + state.scan.candidates.length + ' 张，但当前「' + ($('sel-filter') && $('sel-filter').selectedOptions[0] ? $('sel-filter').selectedOptions[0].textContent : '筛选') + '」下为空，请切换筛选查看';
    } else if (!recs.length) {
      $('img-empty').textContent = '没有可显示的图片';
    }
    updateSelSummary();
  }

  function chosenUrl(rec) { return state.chosen.get(rec.id) || rec.srcUrl || ''; }

  function buildRow(rec, io) {
    // 兼容旧版本/异常快照，避免单条脏数据导致整批记录被跳过。
    rec = rec && typeof rec === 'object' ? rec : {};
    if (!rec.id) rec.id = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    if (!Array.isArray(rec.candidates)) rec.candidates = rec.srcUrl ? [{ url: rec.srcUrl, source: 'src', dims: null }] : [];
    else rec.candidates = rec.candidates.filter((c) => c && typeof c === 'object' && typeof c.url === 'string');
    const li = document.createElement('li');
    li.className = 'img-item';
    if (state.layout === 'grid') li.classList.add('grid-item');
    li.style.position = 'relative';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.sel.has(rec.id);
    cb.addEventListener('change', () => {
      if (cb.checked) state.sel.add(rec.id); else state.sel.delete(rec.id);
      updateSelSummary(); updateUploadButtons();
    });

    const img = document.createElement('img');
    img.className = 'thumb';
    if (state.thumbMode === 'contain') img.classList.add('thumb-contain');
    img.loading = 'lazy';
    img.alt = '';
    // 缩略图优先通过后台/页面会话读取并缓存，ZIP 可直接复用已读取的数据。
    const turl = thumbOf(rec);
    const loadThumb = () => {
      if (!img.dataset.proxied || img.dataset.proxied === turl) {
        img.dataset.proxied = turl;
        proxiedThumbUrl(rec).then((url) => { if (url && url !== img.src) img.src = url; });
      }
    };
    // 不依赖 IntersectionObserver：弹窗列表本身是动态 flex/overflow 容器，部分
    // Chromium 版本不会触发以列表为 root 的观察器，导致所有缩略图空白。
    // 直接开始加载，后台代理仍会按权限处理防盗链资源。
    img._rec = rec;
    img.addEventListener('click', () => openPreview(rec));
    loadThumb();
    // IntersectionObserver 触发时，除了懒加载原图也会走代理
    img.addEventListener('error', () => img.classList.add('err'));
    img.addEventListener('load', () => img.classList.remove('err'));

    const info = document.createElement('div');
    info.className = 'img-info';

    const title = document.createElement('div');
    title.className = 'img-title';
    const dims = document.createElement('span');
    dims.className = 'dims';
    const w = rec.width || 0, h = rec.height || 0;
    dims.textContent = w && h ? `${w} × ${h}` : '尺寸未知';
    title.appendChild(dims);
    const ext = document.createElement('span'); ext.className = 'ext'; ext.textContent = (rec.ext || '?').toUpperCase(); if (!rec.ext) ext.title = '未知格式：图片地址未包含可识别的扩展名'; title.appendChild(ext);
    if (!rec.isDuplicate && !rec.isLikelyThumb && rec.isLikelyOriginal && w && h) title.appendChild(tag('高清候选', 'hd'));
    if (rec.isLikelyThumb) title.appendChild(tag('疑似缩略图', 'thumb'));
    if (rec.isDuplicate) title.appendChild(tag('重复', 'dup'));
    const zoom = document.createElement('button'); zoom.className = 'zoom-btn'; zoom.textContent = '🔍'; zoom.title = '放大预览'; zoom.addEventListener('click', () => openPreview(rec)); title.appendChild(zoom);
    if (rec.isDecor) {
      const label = rec.isAvatar ? '头像' : rec.isIcon ? '图标' : rec.isAd ? '广告' : '装饰';
      title.appendChild(tag(label, 'decor'));
    }
    if (!(w && h)) title.appendChild(tag('未确认高清', 'unk'));
    info.appendChild(title);

    const urlLine = document.createElement('div');
    urlLine.className = 'img-url';
    urlLine.textContent = chosenUrl(rec);
    info.appendChild(urlLine);
    if (rec.warning) {
      const warn = document.createElement('div'); warn.className = 'img-warn'; warn.textContent = rec.warning; info.appendChild(warn);
    }

    const actions = document.createElement('div');
    actions.className = 'img-actions';
    const nCand = rec.candidates.length;
    if (nCand > 1) {
      const selC = document.createElement('select');
      selC.className = 'cand-select';
      selC.title = '候选资源（含推断原图）';
      const opts = rec.candidates.map((cd, i) => ({ url: cd.url, label: cd.dims && (cd.dims.width || cd.dims.height) ? `${i === 0 ? '主' : '候选'} ${cd.dims.width || '?'}×${cd.dims.height || '?'}` : `候选${i + 1}` }));
      const cur = chosenUrl(rec);
      let curIdx = opts.findIndex((o) => o.url === cur); if (curIdx < 0) curIdx = 0;
      opts.forEach((o, i) => {
        const op = document.createElement('option'); op.value = o.url; op.textContent = o.label; if (i === curIdx) op.selected = true;
        selC.appendChild(op);
      });
      selC.addEventListener('change', () => {
        state.chosen.set(rec.id, selC.value);
        const cd = rec.candidates.find((x) => x.url === selC.value);
        if (cd && cd.dims) { rec.width = cd.dims.width || 0; rec.height = cd.dims.height || 0; }
        urlLine.textContent = selC.value;
        renderList(); // 简单整表刷新以同步缩略图/徽标
      });
      actions.appendChild(selC);
    }
    const btnOpen = document.createElement('button');
    btnOpen.className = 'mini-btn'; btnOpen.textContent = '查看原图'; btnOpen.title = '新标签页打开';
    btnOpen.addEventListener('click', () => chrome.tabs.create({ url: chosenUrl(rec) }));
    const btnCopy = document.createElement('button');
    btnCopy.className = 'mini-btn'; btnCopy.textContent = '复制地址';
    btnCopy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(chosenUrl(rec)); toast('已复制图片地址'); }
      catch (e) { toast('复制失败', true); }
    });
    const btnUp = document.createElement('button');
    btnUp.className = 'mini-btn img-upload-btn'; btnUp.textContent = '上传';
    btnUp.addEventListener('click', () => uploadSelected([rec.id]));
    actions.append(btnOpen, btnCopy, btnUp);
    info.appendChild(actions);

    li.append(cb, img, info);
    return li;
  }
  const tag = (text, cls) => { const s = document.createElement('span'); s.className = 'tag ' + cls; s.textContent = text; return s; };

  function onBulkSelect(kind) {
    const recs = visibleRecs();
    if (kind === 'all') recs.forEach((c) => state.sel.add(c.id));
    else if (kind === 'none') state.sel.clear();
    else if (kind === 'invert') { const ids = new Set(recs.map((c) => c.id)); for (const id of ids) { if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id); } }
    else if (kind === 'hd') {
      state.sel.clear();
      recs.filter((c) => !c.isDuplicate && !c.isLikelyThumb && !c.isDecor && c.width * c.height > 0).forEach((c) => state.sel.add(c.id));
    }
    renderList();
  }

  function updateSelSummary() { $('sel-summary').textContent = `已选 ${state.sel.size} 张`; }
  function updateUploadButtons() {
    $('btn-upload').disabled = !state.sel.size;
    $('btn-upload-one').disabled = !state.sel.size;
    $('btn-download-zip').disabled = !state.sel.size;
    $('btn-upload-one').textContent = '下载选中';
  }

  // 生成 ZIP（无压缩存储模式，兼容性好且不依赖第三方库）。
  function crc32(data) {
    let c = 0xffffffff;
    for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder(), chunks = [], central = []; let offset = 0;
    const put16 = (a, n) => a.push(n & 255, (n >>> 8) & 255);
    const put32 = (a, n) => a.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    const now = new Date(), dostime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosdate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = new Uint8Array(f.bytes), crc = crc32(data), h = [];
      put32(h, 0x04034b50); put16(h, 20); put16(h, 0x800); put16(h, 0); put16(h, dostime); put16(h, dosdate); put32(h, crc); put32(h, data.length); put32(h, data.length); put16(h, name.length); put16(h, 0);
      chunks.push(new Uint8Array(h), name, data);
      const c = []; put32(c, 0x02014b50); put16(c, 20); put16(c, 20); put16(c, 0x800); put16(c, 0); put16(c, dostime); put16(c, dosdate); put32(c, crc); put32(c, data.length); put32(c, data.length); put16(c, name.length); put16(c, 0); put16(c, 0); put16(c, 0); put16(c, 0); put32(c, 0); put32(c, offset); central.push(new Uint8Array(c), name);
      offset += h.length + name.length + data.length;
    }
    const cdOffset = offset, cdSize = central.reduce((n, x) => n + x.length, 0); chunks.push(...central);
    const e = []; put32(e, 0x06054b50); put16(e, 0); put16(e, 0); put16(e, files.length); put16(e, files.length); put32(e, cdSize); put32(e, cdOffset); put16(e, 0); chunks.push(new Uint8Array(e));
    return new Blob(chunks, { type: 'application/zip' });
  }
  async function downloadSelectedZip(ids) {
    if (!ids.length) return;
    // ZIP 必须读取图片二进制；先在用户手势内申请网页权限，避免 X 等站点仅能显示而无法读取。
    const recs = ids.map((id) => ((state.scan && state.scan.candidates) || []).find((c) => c.id === id)).filter(Boolean);
    const files = [], used = new Set(); let failed = 0;
    const hostGranted = await ensureHostPerms();
    if (!hostGranted) toast('未获得网页访问权限，无法读取图片并打包；请在扩展权限中允许“访问所有网站”', true);
    for (const rec of recs) {
      const urls = [chosenUrl(rec), thumbOf(rec), ...((rec.candidates || []).map((c) => c && c.url))].filter((u, i, a) => u && a.indexOf(u) === i);
      let bytes = null;
      for (const sourceUrl of urls) {
        const r = await send({ type: 'download_image_bytes', url: sourceUrl, tabId: state.tabId, referrer: (state.scan && state.scan.pageUrl) || '' });
        if (r && r.ok && r.bytes) { bytes = r.bytes; break; }
      }
      // 原图被源站拒绝时，复用内容区已经成功显示的代理缩略图，确保选中项仍可打包。
      if (!bytes) {
        const turl = thumbOf(rec), cached = state._thumbCache && state._thumbCache['thumb:' + turl];
        const t = cached ? { ok: true, dataUrl: cached } : await send({ type: 'proxy_thumb', url: turl, tabId: state.tabId, referrer: (state.scan && state.scan.pageUrl) || '' });
        if (t && t.ok && t.dataUrl) {
          try { bytes = U.base64ToBytes(t.dataUrl.split(',')[1] || '').buffer; } catch (e) { bytes = null; }
        }
      }
      // 最后复用渲染器的完整缩略图流程（可能已在缓存中，也可能刚刚代理成功）。
      if (!bytes) {
        try {
          const rendered = await proxiedThumbUrl(rec);
          if (rendered && rendered.startsWith('data:')) bytes = U.base64ToBytes(rendered.split(',')[1] || '').buffer;
        } catch (e) { /* ignore */ }
      }
      if (!bytes) { failed++; continue; }
      let name = baseName(chosenUrl(rec)) || ('image-' + (files.length + 1));
      const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
      let n = 2; while (used.has(name)) name = `${stem}-${n++}${ext}`; used.add(name); files.push({ name, bytes });
    }
    if (!files.length) { toast('没有可打包的图片，失败 ' + failed + ' 张', true); return; }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const url = URL.createObjectURL(makeZip(files));
    const started = await new Promise((resolve) => chrome.downloads.download({ url, filename: `网页图片-${stamp}-${files.length}张.zip`, saveAs: true }, (id) => { const err = chrome.runtime.lastError; URL.revokeObjectURL(url); resolve(!err && id != null); }));
    toast(started ? `ZIP 已下载 ${files.length} 张${failed ? `，失败 ${failed} 张` : ''}` : 'ZIP 下载失败', true);
  }

  async function downloadSelected(ids) {
    if (!ids.length) return;
    const recs = ids.map((id) => ((state.scan && state.scan.candidates) || []).find((c) => c.id === id)).filter(Boolean);
    if (!recs.length) return;
    let dir = null;
    if (window.showDirectoryPicker) {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    let done = 0, failed = 0;
    for (const rec of recs) {
      const r = await send({ type: 'download_image_bytes', url: chosenUrl(rec), tabId: state.tabId });
      if (!r || !r.ok || !r.bytes) {
        // fetch 被源站拒绝时交给 Chrome 原生下载器，复用浏览器会话。
        const native = await send({ type: 'download_url_native', url: chosenUrl(rec), fileName: baseName(chosenUrl(rec)), saveAs: done === 0 });
        if (native && native.ok) { done++; continue; }
        failed++; continue;
      }
      const name = baseName(chosenUrl(rec)) || ('image-' + Date.now());
      try {
        if (dir) {
          const fh = await dir.getFileHandle(name, { create: true });
          const wr = await fh.createWritable();
          await wr.write(new Blob([r.bytes], { type: r.mime || 'application/octet-stream' }));
          await wr.close();
        } else if (chrome.downloads) {
          const blobUrl = URL.createObjectURL(new Blob([r.bytes], { type: r.mime || 'application/octet-stream' }));
          await new Promise((resolve, reject) => chrome.downloads.download({ url: blobUrl, filename: name, saveAs: done === 0 }, (id) => {
            const err = chrome.runtime.lastError;
            URL.revokeObjectURL(blobUrl);
            if (err || id == null) reject(new Error((err && err.message) || '下载失败')); else resolve();
          }));
        }
        done++;
      } catch (e) { failed++; }
    }
    toast(`已下载 ${done} 张${failed ? `，失败 ${failed} 张` : ''}`, failed > 0);
  }

  /* ---------- 上传 ---------- */
  // 在用户手势内申请「所有网站」主机权限（带上它 SW 可直接抓图，绕过 CORS、更快更稳）
  async function ensureHostPerms() {
    try {
      const has = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
      if (has) { state.hostPerm = true; return true; }
      // manifest 仅声明了 <all_urls>，必须请求完全相同的权限范围。
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
      if (granted) {
        state.hostPerm = true;
        toast('已授予「所有网站」下载权限，上传会更快');
        // 授权后缩略图可走后台代理，重新渲染让图片显示出来
        state._thumbCache = null; renderList();
      }
      return !!granted;
    } catch (e) { return false; }
  }

  async function uploadSelected(ids) {
    if (!ids.length) return;
    const recs = [];
    for (const id of ids) {
      const rec = ((state.scan && state.scan.candidates) || []).find((c) => c.id === id);
      if (rec) recs.push(rec);
    }
    if (!recs.length) return;

    const set = state.settings || { confirmBeforeUpload: true, albumMode: 'none', albumId: '', albumName: '' };
    // 「加入指定相册」当前通过 album-pick 实时选中，这里的 albumId/albumName 已由 change 事件更新
    if (set.confirmBeforeUpload) {
      let target = '自动新建相册';
      if (set.albumMode === 'none') target = '放相册库';
      else if (set.albumMode === 'select') target = set.albumName || '已选相册';
      else if (set.albumMode === 'named') target = set.albumName || '指定相册';
      const ok = confirm(`上传 ${recs.length} 张图片到 Google Photos（目标：${target}）？\n\n提示：上传将占用你的 Google 存储空间；请确认对图片拥有使用权。`);
      if (!ok) return;
    }

    // 尝试申请主机权限（用户手势内）；拒绝则走页面上下文抓取兜底
    await ensureHostPerms();

    const items = recs.map((rec) => ({
      url: chosenUrl(rec),
      fileName: baseName(chosenUrl(rec)),
      width: rec.width || 0, height: rec.height || 0,
      pageUrl: rec.pageUrl || '',
      elType: rec.elType || 'img'
    }));

    $('btn-upload').disabled = true;
    const r = await send({
      type: 'start_upload', items,
      pageUrl: (state.scan && state.scan.pageUrl) || '',
      albumMode: set.albumMode || 'none',
      albumId: set.albumMode === 'select' ? (set.albumId || '') : '',
      albumName: set.albumMode === 'named' ? (set.albumName || '') : (set.albumMode === 'auto' ? (set.autoAlbumName || '') : '')
    });
    $('btn-upload').disabled = false;
    if (!r || !r.ok) {
      if (r && r.code === 'NO_CLIENT_ID') { toast('请先在设置页配置 Google OAuth Client ID', true); chrome.runtime.openOptionsPage(); }
      else if (r && r.code === 'QUOTA_EXCEEDED') { toast((r.message || '本月上传额度已用尽'), true); refreshBilling(); openUpgrade(); }
      else toast((r && r.message) || '发起上传失败', true);
      return;
    }
    toast('任务已创建，可在“上传任务”查看进度');
    state.activeTaskId = r.taskId;
    await loadTasks();
    renderTaskView();
    refreshBilling();
  }

  /* ---------- 账号 ---------- */
  function renderAuth() {
    const connected = state.auth && state.auth.connected;
    $('btn-account').textContent = connected ? '👤' : '＋';
    $('btn-account').title = connected ? (state.auth.maskEmail || '已登录') : '登录 Google 账号';
    $('auth-warning').classList.toggle('hidden', !!connected || !!(state.auth && state.auth.useMock));
  }
  function renderMockBadge() { $('mock-badge').classList.toggle('hidden', !(state.auth && state.auth.useMock)); }
  function bindAccount() {
    $('btn-account').addEventListener('click', async () => {
      if (!state.auth || !state.auth.connected) { loginFlow(); return; }
      const mask = state.auth.maskEmail || '';
      if (confirm(`已登录：${mask}\n\n退出并撤销授权？`)) {
        await send({ type: 'logout' });
        toast('已退出');
        await refreshAuth();
      }
    });
  }
  async function loginFlow() {
    toast('正在打开 Google 授权…');
    const r = await send({ type: 'login' });
    if (r && r.ok) { toast('登录成功'); await refreshAuth(); }
    else toast((r && r.message) || '登录失败', true);
  }
  async function refreshAuth() {
    const r = await send({ type: 'get_auth' });
    if (r && r.ok) { state.auth = r.state; renderAuth(); renderMockBadge(); updateAlbumHint(); }
  }

  /* ---------- 会员/额度 ---------- */
  function renderBilling(status, loggedIn) {
    const bar = $('billing-bar');
    const quoteOn = !!(state.settings && state.settings.billing && state.settings.billing.quoteEnabled);
    if (!quoteOn) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const label = $('quota-label');
    const value = $('quota-value');
    const loginBtn = $('btn-billing-login');
    if (!status || !loggedIn) {
      label.textContent = '会员额度（未登录）';
      value.textContent = '—';
      loginBtn.classList.remove('hidden');
      loginBtn.textContent = '登录';
      return;
    }
    loginBtn.classList.add('hidden');
    const free = status.plan_quota || {};
    const rem = status.upload_remaining;
    const totalMax = Math.max(status.plan_quota.upload || 1, status.upload_remaining || 1, 1);
    value.textContent = String(rem != null ? rem : '—');
    value.classList.toggle('low', (rem || 0) <= 0);
    value.title = `上传剩余 ${rem} · 总额度 ${totalMax}（含免费+套餐）`;
  }
  async function refreshBilling() {
    try {
      const r = await send({ type: 'billing_status' });
      const st = r && r.ok ? r.status : null;
      state.billingLoggedIn = !!(r && r.loggedIn);
      renderBilling(st, state.billingLoggedIn);
    } catch (e) { renderBilling(null, false); }
  }

  /* ---------- 公告/维护横幅 ---------- */
  async function loadAnnouncement() {
    const banner = $('announce-banner');
    const text = $('announce-text');
    const close = $('announce-close');
    if (!banner || !text) return;
    try {
      const r = await send({ type: 'get_public_config' });
      const cfg = (r && r.ok && r.config) || {};
      // 维护模式提示（优先）
      if (cfg.maintenance && cfg.maintenance.enabled) {
        text.textContent = '维护：' + (cfg.maintenance.message || '系统维护中');
        banner.classList.remove('hidden', 'maint');
        banner.classList.add('maint');
        return;
      }
      // 公告
      const ann = cfg.announcement || {};
      const title = ann.title || '';
      const content = ann.content || '';
      const enabled = ann.enabled;
      if (enabled && (title || content)) {
        text.textContent = title ? (content ? `${title}：${content}` : title) : content;
        banner.classList.remove('hidden', 'maint');
      } else {
        banner.classList.add('hidden');
      }
    } catch (e) {
      banner.classList.add('hidden');
    }
    if (close) close.addEventListener('click', () => banner.classList.add('hidden'));
  }
  function bindBilling() {
    $('btn-billing-login').addEventListener('click', () => openUpgrade(true));
    $('btn-upgrade').addEventListener('click', () => openUpgrade(false));
    $('upgrade-close').addEventListener('click', closeUpgrade);
    $('upgrade-modal').addEventListener('click', (e) => { if (e.target === $('upgrade-modal')) closeUpgrade(); });
    $('btn-billing-open-options').addEventListener('click', () => { closeUpgrade(); chrome.runtime.openOptionsPage(); });
    $('btn-billing-do-login').addEventListener('click', async () => {
      const email = $('billing-email').value.trim();
      const password = $('billing-password').value;
      const mode = 'dev'; // 默认开发者登录；可后续切换为密码注册/登录
      $('billing-login-msg').textContent = '登录中…';
      const r = await send({ type: 'billing_login', mode, email, password, register: false });
      if (r && r.ok) { $('billing-login-msg').textContent = '登录成功 ✓'; toast('已登录产品账号'); setBillingMode('plans'); loadPlans(); refreshBilling(); }
      else { $('billing-login-msg').textContent = (r && r.message) || '登录失败'; }
    });
  }

  /* 登录后切到套餐视图 */
  function setBillingMode(mode) {
    if (mode === 'plans') {
      $('upgrade-title').textContent = '选择套餐';
      $('upgrade-login').classList.add('hidden');
      $('upgrade-plans').classList.remove('hidden');
    } else {
      $('upgrade-title').textContent = '登录产品账号';
      $('upgrade-login').classList.remove('hidden');
      $('upgrade-plans').classList.add('hidden');
    }
  }

  /* 打开升级/登录弹层 */
  async function openUpgrade(forceLogin) {
    const m = $('upgrade-modal');
    m.classList.remove('hidden');
    $('billing-login-msg').textContent = '';
    $('upgrade-status').textContent = '';
    const st = await send({ type: 'billing_status' });
    const loggedIn = !!(st && st.loggedIn);
    const configured = !!(st && st.configured);
    if (!configured) {
      $('upgrade-title').textContent = '请先配置收费后端';
      $('upgrade-login').classList.remove('hidden');
      $('upgrade-plans').classList.add('hidden');
      $('billing-login-msg').textContent = '在设置页「收费与会员」中填写后端地址即可启用额度校验与升级。';
      return;
    }
    if (!loggedIn || forceLogin) {
      $('upgrade-title').textContent = '登录产品账号';
      $('upgrade-login').classList.remove('hidden');
      $('upgrade-plans').classList.add('hidden');
      return;
    }
    loadPlans();
  }

  async function closeUpgrade() {
    $('upgrade-modal').classList.add('hidden');
  }

  /* 加载并渲染套餐列表 */
  async function loadPlans() {
    const m = $('upgrade-modal');
    $('upgrade-title').textContent = '选择套餐';
    $('upgrade-login').classList.add('hidden');
    $('upgrade-plans').classList.remove('hidden');
    const r = await send({ type: 'billing_plans' });
    const ul = $('upgrade-plan-list');
    ul.innerHTML = '';
    const plans = (r && r.ok ? r.plans : []) || [];
    for (const p of plans) {
      if (!p.isActive && p.isActive !== undefined) continue;
      if (p.code === 'free') continue;
      const li = document.createElement('li');
      li.className = 'plan-item';
      const info = document.createElement('div');
      const nm = document.createElement('strong'); nm.textContent = p.name;
      const meta = document.createElement('span'); meta.className = 'plan-meta';
      meta.textContent = `¥${((p.priceCents ?? p.price_cents ?? 0) / 100).toFixed(0)} · 上传${(p.uploadQuota ?? p.upload_quota ?? 0)}次`;
      info.appendChild(nm); info.appendChild(meta);
      const buy = document.createElement('button');
      buy.className = 'mini-btn primary';
      buy.textContent = '购买';
      buy.addEventListener('click', () => buyPlan(p.code));
      li.appendChild(info); li.appendChild(buy);
      ul.appendChild(li);
    }
    if (!plans.length) { const li = document.createElement('li'); li.textContent = '暂无可购套餐'; ul.appendChild(li); }
    $('upgrade-status').textContent = '默认使用 mock 支付（开发）。接入支付宝/微信/PayPal 请在管理后台配置。';
  }

  /* 购买套餐：mock 通道下单即支付 */
  async function buyPlan(planCode) {
    $('upgrade-status').textContent = '正在下单…';
    const r = await send({ type: 'billing_checkout', planCode, provider: 'mock', autoPay: true });
    if (!r || !r.ok) { $('upgrade-status').textContent = (r && r.message) || '购买失败'; return; }
    $('upgrade-status').textContent = '购买成功，额度已到账 ✓';
    toast('升级成功');
    refreshBilling();
    setTimeout(closeUpgrade, 900);
  }

  /* ---------- 已有相册 ---------- */
  // 依据设置里的 albumMode 显示/隐藏相册选择控件，并更新提示
  function renderAlbumControls() {
    const target = $('album-target');
    const pick = $('album-pick');
    const rb = $('btn-refresh-albums');
    const mode = state.settings && state.settings.albumMode;
    const autoName = $('album-auto-name');
    if (autoName) {
      autoName.classList.toggle('hidden', mode !== 'auto');
      autoName.value = (state.settings && state.settings.autoAlbumName) || '';
    }
    if (mode === 'select') {
      if (target) target.value = 'select';
      if (rb) rb.classList.remove('hidden');
      // 填充下拉（保留当前已选相册）
      if (pick) {
        pick.classList.remove('hidden');
        const curId = (state.settings && state.settings.albumId) || '';
        pick.innerHTML = '';
        if (!state.albums.length) {
          const op = document.createElement('option');
          op.value = '-1'; op.textContent = '（暂无相册，点击 ⟳ 刷新）';
          pick.appendChild(op);
        } else {
          let curIdx = 0;
          state.albums.forEach((a, i) => {
            const op = document.createElement('option');
            op.value = String(i);
            op.textContent = a.title + (a.mediaItemsCount ? `（${a.mediaItemsCount}）` : '');
            if (a.id === curId) curIdx = i;
            pick.appendChild(op);
          });
          pick.value = String(curIdx);
        }
      }
    } else {
      if (pick) { pick.classList.add('hidden'); pick.innerHTML = ''; }
      if (rb) rb.classList.add('hidden');
    }
  }

  // 把常见的 API 错误翻译成更明确的提示（引导用户去 Google Cloud 修配置）
  function albumErrorHint(msg) {
    const m = String(msg || '').toLowerCase();
    if (m.includes('has not been used') || m.includes('disabled') || m.includes('not enabled') || m.includes('photoslibrary api')) {
      return 'Google Cloud 尚未启用 Photos Library API：请到 https://console.cloud.google.com/apis/library/photoslibrary.googleapis.com 点击「启用」，等待几分钟后重试';
    }
    if (m.includes('permission')) return '当前账号无权限访问相册（可能未在该项目的测试用户中）';
    if (m.includes('quota')) return '今日 API 配额已用完，请明天再试';
    return null;
  }

  // 向后台拉取本插件创建的相册；silent=true 时错误仅静默
  async function loadExistingAlbums(showToastOnErr) {
    // 未登录时不请求
    if (!state.auth || !state.auth.connected) return;
    const r = await send({ type: 'list_albums' });
    if (r && r.ok) {
      state.albums = r.albums || [];
      renderAlbumControls();
      if ($('album-target').value === 'select' && !state.albums.length && showToastOnErr) {
        toast('当前还没有可用的相册，上传一次后即可在此选择');
      }
    } else if (showToastOnErr) {
      const hint = albumErrorHint(r && r.message);
      toast(hint || (r && r.message) || '获取相册失败', true);
      // 若打开了设置页/文档，提供指引
      if (hint && hint.includes('启用')) {
        $('albums-hint').textContent = hint;
      }
    }
  }

  function updateAlbumHint() {
    const set = state.settings || {};
    const sel = $('album-target');
    // 下拉框只有 auto/none/select 三项；named 由设置页设置，这里仅作展示映射
    if (sel && set.albumMode && ['auto', 'none', 'select'].includes(set.albumMode)) sel.value = set.albumMode;
    renderAlbumControls();
    let hint = '';
    if (set.albumMode === 'auto') hint = set.autoAlbumName
      ? ('将新建相册「' + set.autoAlbumName + '」')
      : '将按相册名模板自动新建（如 网页图片-域名-日期）';
    else if (set.albumMode === 'none') hint = '图片将直接上传到相册库，不归入任何相册';
    else if (set.albumMode === 'named') hint = '将新建相册「' + (set.albumName || '未命名') + '」';
    else if (set.albumMode === 'select') hint = state.albums.length
      ? ('已选相册「' + (set.albumName || '未命名') + '」，可在上方下拉切换')
      : ('首次使用暂无相册，请先上传一次，或点右侧 ⟳ 刷新');
    else hint = '';
    $('albums-hint').textContent = hint;
  }
  function onAuthRequired(reason, taskId) {
    const text = reason || 'Google Photos 授权失效';
    toast(text + '，请点击账号重新授权', true);
    $('auth-warning').classList.remove('hidden');
  }

  /* ---------- 任务视图 ---------- */
  async function loadTasks() {
    const r = await send({ type: 'get_tasks' });
    if (r && r.ok) state.tasks = r.tasks || [];
    if (!state.tasks.some((t) => t.id === state.activeTaskId) && state.tasks.length) state.activeTaskId = state.tasks[0].id;
    updateTaskBadge();
    return state.tasks;
  }
  function updateTaskBadge() {
    const running = (state.tasks || []).filter((t) => t.status === 'running').length;
    const b = $('task-count-badge');
    b.textContent = String(running || '');
    b.classList.toggle('hidden', !running);
  }
  function onTaskEvent(task) {
    if (!task) return;
    const idx = state.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) state.tasks[idx] = task; else state.tasks.unshift(task);
    updateTaskBadge();
    if (state.view === 'tasks') renderTaskView();
    else if (state.activeTaskId === task.id) { /* 后台刷新 */ }
  }
  function onTaskFinished(taskId, status) {
    state.tasks = (state.tasks || []).filter((t) => t.id !== taskId);
    updateTaskBadge();
    if (state.activeTaskId === taskId) state.activeTaskId = state.tasks.length ? state.tasks[0].id : null;
    if (state.view === 'tasks') renderTaskView();
    const label = status === 'completed' ? '全部完成' : (status === 'failed' ? '上传失败' : '任务已' + (STATUS_TEXT[status] || status));
    toast(label + (status === 'completed' ? ' 🎉' : ''));
  }
  async function taskCtrl(type) {
    if (!state.activeTaskId) return;
    await send({ type, taskId: state.activeTaskId });
    if (type === 'retry_failed' || type === 'resume_task') { await loadTasks(); renderTaskView(); }
    else { await loadTasks(); renderTaskView(); }
  }

  function taskProgress(t) {
    const done = (t.counts.succeeded || 0) + (t.counts.failed || 0) + (t.counts.skipped || 0) + (t.counts.cancelled || 0);
    return t.total ? Math.min(100, Math.round((done / t.total) * 100)) : 0;
  }

  function renderTaskView() {
    const list = state.tasks || [];
    const completed = list.filter((t) => t.status === 'completed').length;
    const failed = list.filter((t) => t.status === 'failed').length;
    $('btn-clear-completed').disabled = completed === 0;
    $('btn-clear-failed').disabled = failed === 0;
    $('task-clean-hint').textContent = (completed || failed) ? `已完成 ${completed} · 失败 ${failed}` : '';
    $('task-empty').classList.toggle('hidden', list.length > 0);
    $('task-detail').classList.toggle('hidden', !list.length);
    if (!list.length) return;
    if (!state.activeTaskId || !list.some((t) => t.id === state.activeTaskId)) state.activeTaskId = list[0].id;
    const t = list.find((x) => x.id === state.activeTaskId) || list[0];

    const label = STATUS_TEXT[t.status] || t.status;
    $('task-status').textContent = label;
    $('task-status').className = 'chip ' + (TAG_CLASS[t.status] || '');
    const name = domainOf(t.pageUrl) || '批量上传';
    $('task-name').textContent = `${name}${t.albumName ? ' → ' + t.albumName : ''}`;
    $('task-name').title = t.pageUrl || '';

    const pct = taskProgress(t);
    $('task-progress').style.width = pct + '%';
    $('task-progress-text').textContent = pct + '%';

    const c = t.counts || {};
    $('task-stats').innerHTML = '';
    const stats = [
      ['总数', t.total || 0, ''],
      ['成功', c.succeeded || 0, 'stat-ok'],
      ['失败', c.failed || 0, 'stat-fail'],
      ['跳过', c.skipped || 0, 'stat-skip'],
      ['取消', c.cancelled || 0, '']
    ];
    for (const [k, v, cls] of stats) {
      const s = document.createElement('span');
      s.innerHTML = `${k} <b>${v}</b>`;
      if (cls) s.classList.add(cls);
      $('task-stats').appendChild(s);
    }

    // 阶段说明
    const active = t.items.filter((it) => ['downloading', 'uploading', 'queued'].includes(it.status));
    const phaseEl = $('task-phase');
    if (t.status === 'running' && active.length) {
      const doing = t.items.find((it) => it.status === 'downloading' || it.status === 'uploading');
      const desc = doing
        ? (doing.status === 'downloading' ? '下载中：' : '上传中：') + (doing.fileName || doing.url)
        : `剩余 ${active.length} 张等待处理`;
      phaseEl.textContent = desc;
    } else if (t.status === 'paused') phaseEl.textContent = '任务已暂停（授权失效时请重新登录后继续）';
    else phaseEl.textContent = t.status === 'running' ? '正在准备队列…' : '';

    $('btn-pause').classList.toggle('hidden', t.status !== 'running');
    $('btn-resume').classList.toggle('hidden', t.status !== 'paused');
    $('btn-cancel').disabled = !['running', 'paused', 'queued'].includes(t.status);
    const hasFail = t.items.some((it) => it.status === 'failed');
    $('btn-retry-failed').disabled = !hasFail;

    const listEl = $('task-items');
    listEl.innerHTML = '';
    for (const it of t.items.slice(0, 300)) {
      const li = document.createElement('li');
      li.className = 'task-item';
      const st = document.createElement('span');
      st.className = 'item-st ' + (TAG_CLASS[it.status] || '');
      st.textContent = STATUS_TEXT[it.status] || it.status;
      const main = document.createElement('div');
      main.className = 'item-main';
      const thumb = document.createElement('img');
      thumb.className = 'task-thumb'; thumb.src = it.thumbUrl || it.url || ''; thumb.alt = '';
      thumb.onerror = () => thumb.classList.add('err');
      li.appendChild(thumb);
      const nameEl = document.createElement('div');
      nameEl.className = 'item-name';
      nameEl.textContent = (it.fileName || it.url).length > 90 ? (it.fileName || it.url).slice(0, 90) + '…' : (it.fileName || it.url);
      main.appendChild(nameEl);
      if (it.errorMessage || (it.status === 'skipped' && it.errorCode)) {
        const errEl = document.createElement('div');
        errEl.className = 'item-err';
        errEl.textContent = (it.errorCode ? `[${it.errorCode}] ` : '') + (it.errorMessage || '');
        main.appendChild(errEl);
      }
      if (['downloading', 'uploading', 'queued'].includes(it.status) && t.status === 'running') {
        const bar = document.createElement('div');
        bar.className = 'item-bar';
        const inner = document.createElement('div');
        inner.style.width = (it.progress || 0) + '%';
        bar.appendChild(inner);
        main.appendChild(bar);
      }
      li.append(st, main);
      if (['failed', 'skipped', 'cancelled'].includes(it.status) && !(it.status === 'skipped' && it.isDuplicate)) {
        const rb = document.createElement('button');
        rb.className = 'mini-btn'; rb.textContent = '重试';
        rb.addEventListener('click', async () => {
          await send({ type: 'retry_item', taskId: t.id, itemId: it.id });
          await loadTasks(); renderTaskView();
        });
        li.appendChild(rb);
      }
      listEl.appendChild(li);
    }

    // CORS / 权限失败提示：引导用户授予「所有网站」下载权限
    const corsFails = t.items.filter((it) => it.status === 'failed' && (it.errorCode === 'CORS' || /cors|failed to fetch|跨域/i.test(it.errorMessage || '')));
    if (corsFails.length) {
      let hintEl = $('task-cors-hint');
      if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.id = 'task-cors-hint';
        hintEl.className = 'task-cors-hint';
        const p1 = document.createElement('p');
        p1.textContent = `有 ${corsFails.length} 张图片因跨域（防盗链/Referer 校验）下载失败。`;
        const btn = document.createElement('button');
        btn.className = 'mini-btn primary'; btn.textContent = '授予「所有网站」下载权限后重试';
        btn.addEventListener('click', async () => {
          await ensureHostPerms();
          // 重新触发整批失败重试
          await taskCtrl('retry_failed');
        });
        const p2 = document.createElement('p');
        p2.className = 'hint';
        p2.textContent = '授予后扩展后台可直接抓取图片（绕过跨域），速度更快、成功率更高。';
        hintEl.appendChild(p1); hintEl.appendChild(btn); hintEl.appendChild(p2);
        $('task-detail').appendChild(hintEl);
      }
    } else {
      const hintEl = $('task-cors-hint');
      if (hintEl) hintEl.remove();
    }
  }

  async function clearTasks(filter) {
    const label = filter === 'completed' ? '已完成' : '失败';
    const count = (state.tasks || []).filter((t) => t.status === filter).length;
    if (!count || !confirm(`确定清理 ${count} 个${label}任务吗？历史记录不会删除。`)) return;
    const r = await send({ type: 'clear_tasks', filter });
    if (!r || !r.ok) { toast('清理失败', true); return; }
    await loadTasks();
    renderTaskView();
    toast(`已清理 ${r.removed || 0} 个${label}任务`);
  }

  /* ---------- 历史 ---------- */
  async function loadHistory() {
    const r = await send({ type: 'list_history' });
    if (r && r.ok) { state.history = r.history || []; renderHistory(); }
  }
  function renderHistory() {
    const list = state.history || [];
    $('history-empty').classList.toggle('hidden', list.length > 0);
    $('history-hint').textContent = list.length ? `共 ${list.length} 条（本地存储，可清空）` : '';
    const el = $('history-list');
    el.innerHTML = '';
    for (const h of list) {
      const li = document.createElement('li');
      li.className = 'hist-item';
      const top = document.createElement('div');
      top.className = 'hist-top';
      const left = document.createElement('div');
      const nm = document.createElement('strong'); nm.textContent = domainOf(h.pageUrl) || '批量上传';
      left.appendChild(nm);
      const tm = document.createElement('div'); tm.className = 'hist-time'; tm.textContent = fmtClock(h.createdAt) + (h.finishedAt ? ' 完成' : '');
      left.appendChild(tm);
      top.appendChild(left);
      const chip = document.createElement('span');
      chip.className = 'chip ' + (TAG_CLASS[h.status === 'cancelled' ? 'cancelledTask' : (h.status === 'failed' ? 'failedTask' : h.status)] || '');
      chip.textContent = STATUS_TEXT[h.status === 'cancelled' ? 'cancelled' : h.status] || h.status;
      top.appendChild(chip);
      li.appendChild(top);

      const c = h.counts || {};
      const det = document.createElement('div');
      det.className = 'hist-detail';
      det.textContent = `${h.total} 张 · 成功 ${c.succeeded || 0} · 失败 ${c.failed || 0} · 跳过 ${c.skipped || 0}${h.albumName ? ' · ' + h.albumName : ''}`;
      li.appendChild(det);

      const thumbs = (h.items || []).slice(0, 6);
      if (thumbs.length) {
        const strip = document.createElement('div'); strip.className = 'hist-thumbs';
        thumbs.forEach((it) => { const im = document.createElement('img'); im.src = it.url || ''; im.alt = ''; im.onerror = () => im.classList.add('err'); strip.appendChild(im); });
        li.appendChild(strip);
      }

      if (h.failedItems && h.failedItems.length) {
        const fails = document.createElement('ul');
        fails.className = 'hist-fails';
        for (const f of h.failedItems.slice(0, 20)) {
          const fl = document.createElement('li');
          const name = document.createElement('span'); name.textContent = f.fileName || f.url;
          const err = document.createElement('span'); err.className = 'err'; err.textContent = f.errorMessage || f.errorCode || '';
          fl.append(name, err);
          fails.appendChild(fl);
        }
        if (h.failedItems.length > 20) {
          const more = document.createElement('li'); more.textContent = `…另有 ${h.failedItems.length - 20} 条失败`;
          fails.appendChild(more);
        }
        li.appendChild(fails);
      }

      const ct = document.createElement('div');
      ct.className = 'hist-ctrls';
      const open = document.createElement('button'); open.className = 'mini-btn'; open.textContent = '打开来源页';
      open.addEventListener('click', () => h.pageUrl && chrome.tabs.create({ url: h.pageUrl }));
      ct.appendChild(open);
      if (h.failedItems && h.failedItems.length) {
        const retry = document.createElement('button'); retry.className = 'mini-btn'; retry.textContent = '重试失败项';
        retry.addEventListener('click', async () => {
          const r = await send({ type: 'retry_history', entryId: h.id });
          if (r && r.ok) { toast('已创建重试任务'); state.activeTaskId = r.taskId; await loadTasks(); switchView('tasks'); }
          else toast((r && r.message) || '重试失败', true);
        });
        ct.appendChild(retry);
      }
      li.appendChild(ct);
      el.appendChild(li);
    }
  }
  async function clearHistory() {
    if (!state.history.length) return;
    if (!confirm('确定清空全部历史记录？此操作不可恢复。')) return;
    await send({ type: 'clear_history' });
    toast('历史已清空');
    loadHistory();
  }

  document.addEventListener('DOMContentLoaded', () => boot());
})();
