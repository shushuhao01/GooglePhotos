/* PGX.Photos —— Google Photos Library API 客户端（uploads/batchCreate/albums）
 * 支持 mock 传输（settings.auth.useMock），用于无凭据联调。 */
(function () {
  const R = (typeof self !== 'undefined' ? self : globalThis);
  R.PGX = R.PGX || {};
  const PGX = R.PGX;
  const U = PGX.U;
  const C = PGX.C;

  const mock = { albums: [], items: 0, bytes: 0, failNext: false };
  // Photos Library 对并发写入（uploads/batchCreate/albums）配额很低，
  // 串行化所有写请求，避免多个任务同时上传触发 concurrent write request。
  let writeTail = Promise.resolve();
  function runWrite(fn) {
    const next = writeTail.then(fn, fn);
    writeTail = next.catch(() => null);
    return next;
  }

  function mapError(status, body, fallbackCode) {
    let code = fallbackCode || C.ERR.SERVER;
    let msg = '';
    // 401 的响应有时是纯文本/空 body，不能依赖 body.error 才识别授权失效。
    if (status === 401) code = C.ERR.AUTH_EXPIRED;
    if (body && body.error) {
      msg = body.error.message || '';
      const reason = (body.error.status || body.error.message || '').toLowerCase();
      if (status === 401 || reason.includes('unauthenticated') || reason.includes('unauthorized')) code = C.ERR.AUTH_EXPIRED;
      else if (status === 429) code = reason.includes('quota') ? C.ERR.QUOTA : C.ERR.RATE_LIMITED;
      else if (status >= 500) code = C.ERR.SERVER;
      else if (status === 403) code = reason.includes('quota') ? C.ERR.QUOTA : C.ERR.SERVER;
      else if (status === 404) code = C.ERR.ALBUM_NOT_FOUND;
      else if (status === 400) code = C.ERR.BAD_REQUEST;
    }
    if (!msg && typeof body === 'string' && body.trim()) msg = body.trim().slice(0, 300);
    return { code, message: msg || ('HTTP ' + status) };
  }

  async function request(method, path, token, body, headers) {
    if (method !== 'GET' && method !== 'HEAD') {
      return runWrite(() => requestNow(method, path, token, body, headers));
    }
    return requestNow(method, path, token, body, headers);
  }

  async function requestNow(method, path, token, body, headers) {
    const res = await fetch(C.AUTH.PHOTOS_ROOT + path, {
      method,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, headers || {}),
      body: body !== undefined ? body : undefined
    });
    let data = null;
    const ct = (res.headers.get('content-type') || '');
    if (res.status !== 204) {
      if (ct.includes('json')) data = await res.json().catch(() => null);
      else data = await res.text().catch(() => '');
    }
    if (!res.ok) {
      if (res.status === 401) {
        try { console.error('[PGX] Google Photos 401', { path, wwwAuthenticate: res.headers.get('www-authenticate') || '', body: data }); } catch (e) { /* noop */ }
      }
      return { ok: false, status: res.status, error: mapError(res.status, data) };
    }
    return { ok: true, status: res.status, data };
  }

  async function doRequest(method, path, getToken, body, headers, isRetryAfter401) {
    const token = await getToken(true);
    const r = await request(method, path, token, body, headers);
    if (!r.ok && r.status === 401 && !isRetryAfter401) {
      // 通知认证层刷新后重试一次
      try {
        // 第二次请求要求认证层强制刷新（尤其是 chrome.identity 无过期时间的 token）。
        const t2 = await getToken(true, true);
        const r2 = await request(method, path, t2, body, headers);
        if (r2.ok) return r2;
        if (r2.status === 401) {
          // 刷新 token 仍被拒绝时，刷新 token 可能来自已撤销的授权会话；
          // 在用户已发起上传的交互上下文中再完整走一次登录，避免直接把任务判为“未登录”。
          try {
            const fresh = await PGX.Auth.login();
            const r3 = await request(method, path, fresh.accessToken, body, headers);
            if (r3.ok) return r3;
          } catch (e) { /* 交给统一未授权处理 */ }
          await PGX.Auth.handleUnauthorized();
        }
        return r2;
      } catch (e) {
        return { ok: false, status: 401, error: { code: C.ERR.AUTH_EXPIRED, message: String((e && e.message) || '') } };
      }
    }
    return r;
  }

  const Photos = {
    mock,

    /** 上传原始字节，返回 {ok, uploadToken} 或 {ok:false, error} */
    async uploadBytes(getToken, bytes, fileName, mime) {
      const settings = await PGX.Store.getSettings();
      if (settings.auth && settings.auth.useMock) {
        mock.bytes += bytes.byteLength;
        mock.items++;
        const token = 'mock-upload-token-' + U.id();
        await U.sleep(120 + Math.random() * 200);
        return { ok: true, uploadToken: token };
      }
      const fname = encodeURIComponent(fileName || 'image.jpg');
      const r = await doRequest('POST', '/uploads', getToken, bytes, {
        'Content-Type': 'application/octet-stream',
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Content-Type': mime || 'image/jpeg',
        'X-Goog-Upload-File-Name': fname
      });
      if (!r.ok) return r;
      const token = String(r.data || '').trim();
      if (!token) return { ok: false, status: 0, error: { code: C.ERR.SERVER, message: '上传接口未返回 token' } };
      return { ok: true, uploadToken: token };
    },

    /**
     * 批量创建 media item（单批 <=50）
     * items: [{ uploadToken, fileName, description }]
     * 返回 { ok, results: [{mediaItemId?, productUrl?, error?}] }
     */
    async batchCreate(getToken, items, albumId) {
      const settings = await PGX.Store.getSettings();
      if (settings.auth && settings.auth.useMock) {
        const results = items.map((it) => {
          const id = 'mock-media-' + U.id();
          mock.albums = mock.albums; // album 归属简化
          return { mediaItemId: id, productUrl: 'https://photos.google.com/lr/photo/' + id, error: null };
        });
        await U.sleep(100);
        return { ok: true, results };
      }
      const payload = {
        newMediaItems: items.map((it) => ({
          description: it.description || '',
          simpleMediaItem: { uploadToken: it.uploadToken, fileName: it.fileName || 'image.jpg' }
        }))
      };
      if (albumId) payload.albumId = albumId;
      const r = await doRequest('POST', '/mediaItems:batchCreate', getToken, JSON.stringify(payload), { 'Content-Type': 'application/json' });
      if (!r.ok) return r;
      const rawResults = (r.data && (r.data.newMediaItemResults || r.data.results)) || [];
      const results = rawResults.map((it) => {
        const st = it.status || {};
        if (st.code && st.code !== 0) {
          return { mediaItemId: null, productUrl: '', error: { code: C.ERR.SERVER, message: st.message || '创建失败' } };
        }
        const mi = it.mediaItem || {};
        return { mediaItemId: mi.id || null, productUrl: mi.productUrl || '', error: null };
      });
      return { ok: true, results };
    },

    /** 列出可见相册（受 2025 政策限制：仅本插件创建的相册可读写） */
    async listAlbums(getToken) {
      const settings = await PGX.Store.getSettings();
      if (settings.auth && settings.auth.useMock) {
        return { ok: true, albums: mock.albums.length ? mock.albums : [{ id: 'mock-album-demo', title: 'Mock 演示相册', mediaItemsCount: 0 }] };
      }
      const albums = [];
      let pageToken = '';
      for (;;) {
        // Photos Library albums.list 最大 pageSize 为 50，超过会返回 400。
        const q = new URLSearchParams({ pageSize: '50' });
        if (pageToken) q.set('pageToken', pageToken);
        const r = await doRequest('GET', '/albums?' + q.toString(), getToken);
        if (!r.ok) return r;
        const list = (r.data && r.data.albums) || [];
        for (const a of list) albums.push({ id: a.id, title: a.title || '(未命名)', mediaItemsCount: a.mediaItemsCount || 0 });
        pageToken = r.data && r.data.nextPageToken;
        if (!pageToken || !list.length) break;
      }
      return { ok: true, albums };
    },

    async createAlbum(getToken, title) {
      const settings = await PGX.Store.getSettings();
      if (settings.auth && settings.auth.useMock) {
        const album = { id: 'mock-album-' + U.id(), title: title || 'Mock 相册', mediaItemsCount: 0 };
        mock.albums.unshift(album);
        return { ok: true, album };
      }
      const r = await doRequest('POST', '/albums', getToken, JSON.stringify({ album: { title } }), { 'Content-Type': 'application/json' });
      if (!r.ok) return r;
      const a = (r.data && r.data.album) || r.data || {};
      return { ok: true, album: { id: a.id, title: a.title || title, mediaItemsCount: 0 } };
    }
  };

  PGX.Photos = Photos;
})();
