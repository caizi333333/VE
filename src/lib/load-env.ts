/**
 * 脚本侧读取 .env.local，不覆盖已经在进程里的变量。
 *
 * Next.js 自己会加载 .env.local；tsx 直接跑脚本时不会。密钥仍只从环境
 * 变量来，本函数不打印、不落库。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadLocalEnv(start_dir: string = process.cwd()): void {
  const env_path = resolve(start_dir, '.env.local');
  if (!existsSync(env_path)) return;

  for (const raw_line of readFileSync(env_path, 'utf8').split('\n')) {
    const line = raw_line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq_index = line.indexOf('=');
    if (eq_index <= 0) continue;

    const key = line.slice(0, eq_index).trim();
    let value = line.slice(eq_index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();
