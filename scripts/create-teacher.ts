import '../src/lib/load-env';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword, randomToken } from '../src/lib/auth';
import { prisma } from '../src/lib/db';
async function main(){
  const args=process.argv.slice(2); const arg=(name:string,fallback:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]??fallback:fallback;};
  const username=arg('--username','teacher'); const name=arg('--name','任课教师');
  if(!/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) throw new Error('账户名须为3—60位字母、数字、下划线或短横线');
  if(await prisma.teacher.findUnique({where:{username}})) throw new Error('账户已存在，不会覆盖现有密码');
  const password=process.env.TEACHER_INITIAL_PASSWORD || randomToken();
  if(password.length<12 || password.length>256) throw new Error('初始密码须为12—256位');
  mkdirSync('tmp',{recursive:true}); const path=resolve('tmp',`teacher-access-${username}.txt`);
  writeFileSync(path,`教师入口 http://localhost:3100/teacher\n账户 ${username}\n密码 ${password}\n\n此文件仅用于本机保管。不要上传或分享；长期使用时转存至密码管理器后移除此文件。\n`,{mode:0o600,flag:'wx'});
  try { await prisma.teacher.create({data:{username,displayName:name,passwordHash:await hashPassword(password)}}); }
  catch(error) { unlinkSync(path); throw error; }
  console.log(`教师账户已建立，登录信息：${path}`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
