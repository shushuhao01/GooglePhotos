import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database.js';
import { AuditLog } from '../entities/AuditLog.js';

const auditRepo = () => AppDataSource.getRepository(AuditLog);

/* 给请求对象挂角色 */
export function auditLog(req: Request, _res: Response, next: NextFunction) {
  // 记录操作日志：谁、何时、做了什么
  void auditRepo().insert({
    actorId: String((req as any).user?.id || 'anonymous'),
    actor: String((req as any).user?.email || ''),
    action: `${req.method} ${req.path}`,
    targetType: 'api',
    targetId: String((req.params as any)?.id || ''),
    ip: String(req.ip || ''),
  }).catch(() => { /* 审计失败不阻塞主流程 */ });
  next();
}
