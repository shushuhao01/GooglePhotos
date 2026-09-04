/* 简易结构化日志：与 CRM 的 logger 思路一致，输出 JSON 行便于 PM2 采集 */
type Level = 'info' | 'warn' | 'error' | 'debug';

function ts(): string { return new Date().toISOString(); }
function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, time: ts(), msg, ...(meta || {}) });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
};

/* 兼容 CRM 里 log 的用法（log.info / log.error） */
export const log = logger;
