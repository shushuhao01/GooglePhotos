import { Router } from 'express';
import { AppDataSource } from '../config/database.js';
import { Plan } from '../entities/Plan.js';
import { handler } from '../utils/handler.js';
import { ok } from '../utils/response.js';

const r = Router();
const planRepo = () => AppDataSource.getRepository(Plan);

/* 公开套餐列表 */
r.get('/plans', handler(async (_req, res) => {
  const rows = await planRepo().find({ where: { isActive: 1 as any }, order: { priceCents: 'ASC' } });
  return ok(res, { plans: rows });
}));

export default r;
