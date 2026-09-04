import { Router, Request, Response, NextFunction } from 'express';
import { handler } from '../utils/handler.js';

export function api(router: Router): Router {
  return router;
}

/* 挂载路由列表：{ method, path, handler, middleware? } */
type RouteDef = {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  middleware?: ((req: any, res: any, next: any) => any)[];
  handler: (req: any, res: any) => any;
};
export function defineRoutes(defs: RouteDef[]): Router {
  const r = Router();
  for (const d of defs) {
    const h = handler(d.handler);
    if (d.middleware?.length) (r as any)[d.method](d.path, ...d.middleware, h);
    else (r as any)[d.method](d.path, h);
  }
  return r;
}
