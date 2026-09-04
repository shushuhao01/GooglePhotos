/* Options 设置页逻辑：读取/保存设置、账号管理、相册列表、数据清理 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const send = (msg) => new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) resolve({ ok: false, message: chrome.runtime.lastError.message });
      else resolve(resp);
    });
  });
  let settings = null;
  let authState = null;

  function toast(text, err) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  /* ---------- 装载 ---------- */
  async function load() {
    const [r1, r2] = await Promise.all([
      send({ type: 'get_settings' }),
      send({ type: 'get_auth' })
    ]);
    settings = r1 && r1.ok ? r1.settings : null;
    authState = r2 && r2.ok ? r2.state : null;
    if (!settings) { toast('无法读取设置', true); return; }
    fill(settings);
    renderAuth(authState);
  }

  function fill(s) {
    $('auth-method').value = s.auth.method === 'chromeidentity' ? 'chromeidentity' : 'webauth';
    $('auth-clientid').value = s.auth.clientId || '';
    $('use-mock').checked = !!s.auth.useMock;
    $('album-name-template').value = s.auth.albumNameTemplate || '';
    $('min-side').value = s.minSide;
    $('include-gif').checked = !!s.includeGif;
    $('include-cssbg').checked = !!s.includeCssBg;
    $('scan-anchors').checked = !!s.scanAnchors;
    $('skip-decor').checked = s.skipDecor !== false;
    $('auto-scroll').checked = !!s.autoScroll;
    $('album-mode').value = s.albumMode;
    $('album-name').value = s.albumName || '';
    $('album-id').value = s.albumId || '';
    $('max-concurrent').value = s.maxConcurrent;
    $('retries').value = s.retries;
    $('timeout-sec').value = s.timeoutSec;
    $('single-file-limit').value = s.singleFileLimitMB;
    $('skip-duplicates').checked = !!s.skipDuplicates;
    $('confirm-upload').checked = !!s.confirmBeforeUpload;
    $('keep-history').checked = !!s.keepHistory;
    $('history-days').value = s.historyDays;
    // 收费/会员
    if ($('billing-baseurl')) $('billing-baseurl').value = (s.billing && s.billing.baseUrl) || '';
    if ($('billing-quote')) $('billing-quote').checked = !!(s.billing && s.billing.quoteEnabled);
    renderBillingAccount();
    renderRedirectUri();
  }

  /* ---------- redirect URI 与 Client ID 校验 ---------- */
  function renderRedirectUri() {
    const el = $('redirect-uri');
    if (!el) return;
    try {
      // host 级 redirect URI（与 Google Chrome 扩展程序类型客户端自动注册地址一致，勿加 /oauth2）
      const uri = 'https://' + chrome.runtime.id + '.chromiumapp.org/';
      el.textContent = uri;
      el.title = uri;
    } catch (e) { el.textContent = ''; }
  }
  function copyRedirectUri() {
    const txt = $('redirect-uri').textContent || '';
    if (!txt) return toast('暂无 redirect URI', true);
    // 在扩展页里用 clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast('已复制 redirect URI'), () => toast('复制失败，请手动选中复制', true));
    } else toast('当前环境不支持自动复制，请手动复制', true);
  }
  function checkClientId() {
    const id = ($('auth-clientid').value || '').trim();
    const hint = $('clientid-hint') || null;
    if (!id) { toast('请先填写 Client ID', true); return; }
    let ok = true, why = [];
    if (!/\.apps\.googleusercontent\.com$/.test(id)) { ok = false; why.push('结尾应为 .apps.googleusercontent.com'); }
    if (/\.apps\.googleusercontent\.com$/.test(id) && !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) { ok = false; why.push('格式应为 <数字>-<随机串>.apps.googleusercontent.com'); }
    if (ok) toast('Client ID 格式正确 ✓ 可正常发起授权');
    else toast('Client ID 格式疑似有误：' + why.join('；'), true);
  }

  /* ---------- 保存 ---------- */
  async function save() {
    if (!settings) return;
    const s = Object.assign({}, settings, {
      auth: Object.assign({}, settings.auth, {
        method: $('auth-method').value,
        clientId: $('auth-clientid').value.trim(),
        useMock: $('use-mock').checked,
        albumNameTemplate: $('album-name-template').value.trim()
      }),
      minSide: parseInt($('min-side').value, 10),
      includeGif: $('include-gif').checked,
      includeCssBg: $('include-cssbg').checked,
      scanAnchors: $('scan-anchors').checked,
      skipDecor: $('skip-decor').checked,
      autoScroll: $('auto-scroll').checked,
      albumMode: $('album-mode').value,
      albumName: $('album-name').value.trim(),
      albumId: $('album-id').value.trim(),
      maxConcurrent: parseInt($('max-concurrent').value, 10),
      retries: parseInt($('retries').value, 10),
      timeoutSec: parseInt($('timeout-sec').value, 10),
      singleFileLimitMB: parseInt($('single-file-limit').value, 10),
      skipDuplicates: $('skip-duplicates').checked,
      confirmBeforeUpload: $('confirm-upload').checked,
      keepHistory: $('keep-history').checked,
      historyDays: parseInt($('history-days').value, 10),
      billing: Object.assign({}, settings.billing, {
        baseUrl: $('billing-baseurl') ? $('billing-baseurl').value.trim() : (settings.billing && settings.billing.baseUrl) || '',
        // 免费发行版固定关闭额度校验；保留字段供未来商业版恢复。
        quoteEnabled: false
      })
    });
    const r = await send({ type: 'save_settings', settings: s });
    if (r && r.ok) { settings = r.settings; fill(settings); }
    else toast((r && r.message) || '保存失败', true);
  }

  /* ---------- 账号 ---------- */
  function renderAuth(auth) {
    authState = auth || authState;
    if (authState && authState.useMock) { $('account-info').textContent = 'Mock 模式（未连接真实账号）'; }
    else if (authState && authState.connected) $('account-info').textContent = `已登录：${authState.maskEmail || authState.account && authState.account.email || ''}（${authState.method}）`;
    else $('account-info').textContent = '未登录';
    $('btn-logout').disabled = !(authState && authState.connected);
  }

  async function listAlbums() {
    // 需要保证已授权；触发一次 ensureToken（interactive 可选 false 先试）
    const el = $('album-list');
    const r = await send({ type: 'get_auth' });
    const auth = r && r.ok ? r.state : null;
    if (!auth || !auth.connected) {
      toast('请先登录 Google 账号', true);
      el.classList.add('hidden');
      return;
    }
    // 通过后台一次性列出
    const resp = await send({ type: 'list_albums' });
    if (!resp || !resp.ok) { toast((resp && resp.message) || '获取相册失败', true); return; }
    const albums = resp.albums || [];
    el.innerHTML = '';
    for (const a of albums) {
      const row = document.createElement('div');
      row.className = 'album-item';
      const label = document.createElement('span');
      label.textContent = `${a.title}（${a.mediaItemsCount || 0} 项）`;
      label.title = a.id;
      const use = document.createElement('button');
      use.textContent = '使用此相册';
      use.addEventListener('click', () => {
        $('album-id').value = a.id;
        $('album-mode').value = 'select';
        $('album-name').value = a.title;
        save();
        toast('已选：' + a.title);
      });
      row.append(label, use);
      el.appendChild(row);
    }
    if (!albums.length) {
      const row = document.createElement('div');
      row.className = 'album-item';
      row.textContent = '（暂无可用的扩展相册，上传一次后即可在此出现）';
      el.appendChild(row);
    }
    el.classList.remove('hidden');
  }

  /* ---------- 事件 ---------- */
  function bind() {
    const SAVE_IDS = ['auth-method', 'auth-clientid', 'use-mock', 'album-name-template', 'min-side',
      'include-gif', 'include-cssbg', 'scan-anchors', 'skip-decor', 'auto-scroll', 'album-mode', 'album-name', 'album-id',
      'max-concurrent', 'retries', 'timeout-sec', 'single-file-limit', 'skip-duplicates',
      'confirm-upload', 'keep-history', 'history-days', 'billing-baseurl', 'billing-quote'];
    for (const id of SAVE_IDS) {
      const el = $(id);
      const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, debounce(save, 500));
    }
    $('btn-login').addEventListener('click', async () => {
      const r = await send({ type: 'login' });
      if (r && r.ok) { toast('登录成功'); await load(); }
      else toast((r && r.message) || '登录失败', true);
    });
    $('btn-logout').addEventListener('click', async () => {
      if (!confirm('退出并撤销当前 Google 授权？')) return;
      await send({ type: 'logout' });
      toast('已退出');
      await load();
    });
    $('btn-list-albums').addEventListener('click', listAlbums);
    $('btn-clear-history').addEventListener('click', async () => {
      if (!confirm('清空历史记录？')) return;
      await send({ type: 'clear_history' });
      toast('历史已清空');
    });
    $('btn-clear-scan').addEventListener('click', () => chrome.storage.session.clear(() => toast('扫描缓存已清空')));
    $('btn-clear-all').addEventListener('click', async () => {
      if (!confirm('清空全部本地数据？将删除任务、历史、去重索引与 Token，需要重新授权。')) return;
      await chrome.storage.local.clear();
      await chrome.storage.session.clear().catch(() => null);
      toast('本地数据已清空');
      await load();
    });
    $('btn-host-perm').addEventListener('click', async () => {
      const r = await send({ type: 'request_host_perms' });
      toast(r && r.granted ? '已授予网站下载权限' : '未授予（可继续使用页面上下文抓取）', !(r && r.granted));
    });
    const btnCopy = $('btn-copy-redirect');
    if (btnCopy) btnCopy.addEventListener('click', copyRedirectUri);
    const btnCheck = $('btn-check-clientid');
    if (btnCheck) btnCheck.addEventListener('click', checkClientId);
    // 收费/会员
    const btnBt = $('btn-billing-test');
    if (btnBt) btnBt.addEventListener('click', testBilling);
    const btnBl = $('btn-billing-login');
    if (btnBl) btnBl.addEventListener('click', () => chrome.runtime.openOptionsPage() /* 引导用户在弹窗/OpenOptions 登录 */);
    const btnBLogout = $('btn-billing-logout');
    if (btnBLogout) btnBLogout.addEventListener('click', async () => {
      const r = await send({ type: 'billing_logout' });
      toast(r && r.ok ? '已退出产品账号' : (r && r.message) || '退出失败', !(r && r.ok));
      renderBillingAccount();
    });
  }

  /* ---------- 收费/会员 ---------- */
  async function renderBillingAccount() {
    const el = $('billing-account-status');
    if (!el) return;
    const r = await send({ type: 'billing_status' });
    if (r && r.loggedIn) {
      el.textContent = '已登录（可升级/购买额度）';
    } else if (r && r.configured) {
      el.textContent = '未登录（后端已配置）';
    } else {
      el.textContent = '未登录（后端未配置，额度校验关闭）';
    }
  }

  async function testBilling() {
    const url = $('billing-baseurl').value.trim();
    const el = $('billing-test-result');
    if (!url) { el.textContent = '请先填写后端地址'; el.style.color = 'var(--warn)'; return; }
    el.textContent = '测试中…';
    const r = await send({ type: 'billing_test', baseUrl: url });
    if (r && r.reachable) { el.textContent = `连接成功 ✓（${r.plans} 个套餐）`; el.style.color = 'var(--ok)'; }
    else { el.textContent = (r && r.error) || '连接失败'; el.style.color = 'var(--danger)'; }
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  document.addEventListener('DOMContentLoaded', () => { bind(); load(); });
})();
