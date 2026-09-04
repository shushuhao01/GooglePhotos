import { Router } from 'express';
import { handler } from '../utils/handler.js';
import { ok } from '../utils/response.js';
import { systemConfigService } from '../services/AdminService.js';

const r = Router();

/* 公开站点配置：公告 + 维护 + 站点信息
 * 供扩展端/用户端读取（不含任何敏感数据）。
 * GET /public/config
 */
r.get('/public/config', handler(async (_req, res) => {
  const [announcement, maintenance, site] = await Promise.all([
    systemConfigService.get('announcement'),
    systemConfigService.get('maintenance'),
    systemConfigService.get('site'),
  ]);
  return ok(res, {
    config: {
      announcement: announcement || { title: '', content: '', enabled: false },
      maintenance: maintenance || { enabled: false, message: '' },
      site: site || { supportEmail: '', website: '' },
    },
  });
}));

export default r;
