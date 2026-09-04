import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { zipService } from '../services/ZipService.js';
import { handler } from '../utils/handler.js';
import { ok } from '../utils/response.js';

const r = Router();

/* 创建 ZIP 任务（服务端抓取并打包） */
r.post('/zip/jobs', auth, handler(async (req, res) => {
  const d = await zipService.createJob(req.user!.id, req.body?.files as string[]);
  return ok(res, d);
}));

/* 查询 ZIP 状态 */
r.get('/zip/jobs/:jobNo', auth, handler(async (req, res) => {
  const job = await zipService.getJob(req.user!.id, req.params.jobNo);
  return ok(res, { job });
}));

export default r;
