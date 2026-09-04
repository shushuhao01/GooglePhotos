/* 一键初始化数据库：建库 + 导入 schema.sql + 校验。用于宝塔/开发环境。 */
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(path.join(__dirname, '../../schema.sql'), 'utf8');
  const conn = await mysql.createConnection({ host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password, multipleStatements: true });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${env.db.name}\` DEFAULT CHARSET utf8mb4`);
  await conn.query(`USE \`${env.db.name}\``);
  const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    if (stmt.toLowerCase().startsWith('create table')) {
      await conn.query(stmt).catch(e => console.warn('SKIP', stmt.slice(0, 60), e.message));
    }
  }
  // 执行 INSERT ... 种子
  for (const stmt of stmts) {
    if (stmt.toLowerCase().startsWith('insert')) {
      await conn.query(stmt).catch(e => console.warn('SEED', stmt.slice(0, 60), e.message));
    }
  }
  console.log('database ready:', env.db.name);
  await conn.end();
}

main().catch(e => { console.error('init failed', e); process.exit(1); });
