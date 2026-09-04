import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { ok, fail } from '../utils/response.js';
import { safePublicUrl } from '../utils/safeUrl.js';
import { env } from '../config/env.js';

const r = Router();

/* 服务端中转抓取单张图片并流式返回（SSRF 防护 + 大小/类型校验） */
r.post('/proxy/fetch', auth, handler(async (req, res) => {
  const u = safePublicUrl(String(req.body?.url || ''));
  if (!u) return fail(res, 400, 'UNSAFE_URL', 'URL 不允许访问');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), env.proxy.timeoutMs);
  try {
    const upstream = await fetch(u, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'WebImageUploader/1.0', Referer: String(req.body?.referrer || '').slice(0, 500) },
    });
    if (!upstream.ok) return fail(res, 502, 'UPSTREAM_HTTP', '上游返回错误', { status: upstream.status });
    const type = (upstream.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) return fail(res, 415, 'NOT_IMAGE', '非图片内容');
    const len = Number(upstream.headers.get('content-length') || 0);
    if (len > env.proxy.maxBytes) return fail(res, 413, 'FILE_TOO_LARGE', '文件过大');
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > env.proxy.maxBytes) return fail(res, 413, 'FILE_TOO_LARGE', '文件过大');
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.send(buf);
  } catch (e: any) {
    return fail(res, 502, e?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR', '中转失败');
  } finally {
    clearTimeout(timer);
  }
}));

export default r;
