/* PGX.Store —— chrome.storage.local 持久化（设置/任务/历史/去重索引/认证态）
 * 仅供 Service Worker 使用；内容通过内存缓存 + 变更广播保持最新。 */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const U = PGX.U;
  const V = PGX.Validators;
  const C = PGX.C;

  const K = {
    SETTINGS: 'settings',
    AUTH: 'auth',
    TASKS: 'tasks',            // { [taskId]: task }
    HISTORY: 'history',        // [{ task summary }]
    HASH_INDEX: 'hashIndex',   // { [sha256]: { ts, mediaId } }
    SCAN: (tabId) => 'scan_' + tabId
  };

  const Store = {
    K,

    async load(key, fallback) {
      try {
        const got = await chrome.storage.local.get(key);
        return got[key] !== undefined ? got[key] : fallback;
      } catch (e) { return fallback; }
    },
    async save(key, val) {
      await chrome.storage.local.set({ [key]: val });
    },
    async remove(key) {
      await chrome.storage.local.remove(key);
    },

    /* ---------- 设置 ---------- */
    async getSettings() {
      const raw = await Store.load(K.SETTINGS, {});
      return V.sanitizeSettings(raw);
    },
    async saveSettings(next) {
      const clean = V.sanitizeSettings(next);
      await Store.save(K.SETTINGS, clean);
      return clean;
    },

    /* ---------- 认证态 ---------- */
    async getAuth() {
      return (await Store.load(K.AUTH, null)) || null;
    },
    async saveAuth(auth) {
      if (auth === null) await Store.remove(K.AUTH);
      else await Store.save(K.AUTH, auth);
    },

    /* ---------- 任务 ---------- */
    async getTasksMap() {
      return (await Store.load(K.TASKS, {})) || {};
    },
    async saveTask(task) {
      const map = await Store.getTasksMap();
      map[task.id] = task;
      await Store.save(K.TASKS, map);
    },
    async deleteTask(taskId) {
      const map = await Store.getTasksMap();
      delete map[taskId];
      await Store.save(K.TASKS, map);
    },
    async saveTasksMap(map) {
      await Store.save(K.TASKS, map || {});
    },

    /* ---------- 历史 ---------- */
    async getHistory() {
      return (await Store.load(K.HISTORY, [])) || [];
    },
    async pushHistory(entry, keepDays) {
      const list = await Store.getHistory();
      list.unshift(entry);
      const max = keepDays || C.TASK.DEFAULT_HISTORY_DAYS;
      const cutoff = Date.now() - max * 86400000;
      const pruned = list.filter((h) => !h.finishedAt || new Date(h.finishedAt).getTime() >= cutoff);
      if (pruned.length > 500) pruned.length = 500;
      await Store.save(K.HISTORY, pruned);
    },
    async clearHistory() {
      await Store.save(K.HISTORY, []);
    },

    /* ---------- 去重哈希索引 ---------- */
    async getHashIndex() {
      return (await Store.load(K.HASH_INDEX, {})) || {};
    },
    async addHash(hash, mediaId) {
      const idx = await Store.getHashIndex();
      idx[hash] = { ts: Date.now(), mediaId: mediaId || null };
      const keys = Object.keys(idx);
      if (keys.length > C.TASK.DEFAULT_HASH_CAP) {
        keys.sort((a, b) => (idx[a].ts || 0) - (idx[b].ts || 0));
        for (const k of keys.slice(0, keys.length - C.TASK.DEFAULT_HASH_CAP)) delete idx[k];
      }
      await Store.save(K.HASH_INDEX, idx);
    },
    async hasHash(hash) {
      const idx = await Store.getHashIndex();
      return !!idx[hash];
    },

    /* ---------- 扫描快照（chrome.storage.session，会话级） ---------- */
    async saveScan(tabId, snapshot) {
      try { await chrome.storage.session.set({ [K.SCAN(tabId)]: snapshot }); } catch (e) { /* session 不可用时忽略 */ }
    },
    async getScan(tabId) {
      try {
        const got = await chrome.storage.session.get(K.SCAN(tabId));
        return got[K.SCAN(tabId)] || null;
      } catch (e) { return null; }
    },
    async clearScan(tabId) {
      try { await chrome.storage.session.remove(K.SCAN(tabId)); } catch (e) { /* noop */ }
    }
  };

  PGX.Store = Store;
})();
