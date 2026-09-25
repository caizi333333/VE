/** Back up an existing SQLite database, baseline legacy schema, then migrate. */
import '../src/lib/load-env';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const url=process.env.DATABASE_URL ?? 'file:./dev.db';
if(!url.startsWith('file:')) throw new Error('本升级脚本仅支持SQLite');
const path=url.slice(5); const db=isAbsolute(path)?path:resolve('prisma',path);
function run(command:string,args:string[]) { const r=spawnSync(command,args,{encoding:'utf8',env:{...process.env,DATABASE_URL:`file:${db}`}});if(r.status!==0) throw new Error(r.stderr || r.stdout || `${command} failed`);return r.stdout; }
const snapshots: { table: string; columns: string[]; digest: string }[] = [];
const digest = (value:string) => createHash('sha256').update(value).digest('hex');
if(existsSync(db)) {
  for (const table of ['Diagnosis','Review','Pitfall']) {
    const columns = JSON.parse(run('sqlite3',['-json',db,`PRAGMA table_info("${table}");`]) || '[]').map((c:{name:string})=>c.name) as string[];
    if(columns.length) snapshots.push({table,columns,digest:digest(run('sqlite3',['-json',db,`SELECT ${columns.map(c=>'"'+c+'"').join(',')} FROM "${table}" ORDER BY id;`]))});
  }
  mkdirSync('tmp',{recursive:true});
  const backup=resolve('tmp',`backup-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
  run('sqlite3',[db,`.backup '${backup.replaceAll("'","''")}'`]);
  chmodSync(backup,0o600);
  if(run('sqlite3',[backup,'PRAGMA integrity_check;']).trim()!=='ok') throw new Error('备份完整性检查未通过');
  console.log(`已备份：${backup}`);
  const tables=run('sqlite3',[db,"SELECT name FROM sqlite_master WHERE type='table';"]);
  if(tables.includes('Diagnosis')&&!tables.includes('_prisma_migrations')) run('npx',['prisma','migrate','resolve','--applied','0001_legacy']);
}
console.log(run('npx',['prisma','migrate','deploy']));
if(run('sqlite3',[db,'PRAGMA integrity_check;']).trim()!=='ok') throw new Error('迁移后数据库完整性检查失败');
if(run('sqlite3',[db,'PRAGMA foreign_key_check;']).trim()) throw new Error('迁移后外键检查失败');
for(const item of snapshots) {
 const after=digest(run('sqlite3',['-json',db,`SELECT ${item.columns.map(c=>'"'+c+'"').join(',')} FROM "${item.table}" ORDER BY id;`]));
 if(after!==item.digest) throw new Error(`原字段内容发生变化：${item.table}，请使用备份恢复并核查`);
}
chmodSync(db,0o600);
console.log('数据库完整性、外键和原有字段一致性检查通过');
