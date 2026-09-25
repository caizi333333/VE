/** Reversible local examples: no model call and no claim of real classroom activity. */
import '../src/lib/load-env';
import { mkdirSync, writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/db';
import { hashToken, randomToken } from '../src/lib/auth';
import { retrieveConstraint } from '../src/lib/retrieval';
import { buildPracticePack } from '../src/lib/practice-tasks';
import { SAMPLE_CASES } from '../src/lib/samples';
import { allocateTicket } from '../src/lib/ticket';
async function main(){
 const teacher=await prisma.teacher.findUnique({where:{username:'teacher'}});if(!teacher)throw new Error('请先创建本地teacher账户');
 let archive=await prisma.classroom.findFirst({where:{teacherId:teacher.id,dataSource:'legacy_unknown'}});
 if(!archive)archive=await prisma.classroom.create({data:{teacherId:teacher.id,name:'历史建设记录（待核实）',joinCode:randomToken().slice(0,10).toUpperCase(),joinOpen:false,dataSource:'legacy_unknown'}});
 const archived=await prisma.diagnosis.updateMany({where:{classroomId:null,dataSource:'legacy_unknown'},data:{classroomId:archive.id}});
 let demo=await prisma.classroom.findFirst({where:{teacherId:teacher.id,name:'三类故障演示工作区',dataSource:'demo'}});
 if(demo){console.log(`演示工作区已存在；本次归档旧记录 ${archived.count} 条`);return;}
 demo=await prisma.classroom.create({data:{teacherId:teacher.id,name:'三类故障演示工作区',joinCode:randomToken().slice(0,10).toUpperCase(),dataSource:'demo'}});
 const recovery=randomToken();const learner=await prisma.learner.create({data:{classroomId:demo.id,number:'L001',recoveryHash:hashToken(recovery)}});
 mkdirSync('tmp',{recursive:true});writeFileSync('tmp/demo-student-access.txt',`仅用于演示，不是真实学生\n入口 http://localhost:3100/\n班级码 ${demo.joinCode}\n匿名编号 L001\n恢复码 ${recovery}\n`,{mode:0o600,flag:'wx'});
 for(const sample of SAMPLE_CASES){
  const experiment=await prisma.experiment.create({data:{classroomId:demo.id,name:sample.label+' · 演示',faultChainId:sample.id,confirmed:false,configJson:'{}',rubricJson:'[]'}});
  const constraint=retrieveConstraint(sample.symptom,sample.code);const point=sample.id==='uart-garbled'?'7.2.3':sample.id==='timing-inaccurate'?'6.1.4':'5.2.2';
  const instruction='对照实验指导书记录相关寄存器的当前设置，提交观察结果，由教师确认排查顺序。';
  await prisma.diagnosis.create({data:{ticket:await allocateTicket(),classroomId:demo.id,learnerId:learner.id,experimentId:experiment.id,dataSource:'demo',symptomText:sample.symptom,codeText:sample.code,redactionLog:'[]',faultChainId:sample.id,chainPointIds:JSON.stringify(constraint.points.map(p=>p.id)),provider:'example',model:'construction-example',classification:'建设演示样例，等待教师填写或确认指导',checkpoints:JSON.stringify([{id:'r1-cp1',point_id:point,instruction}]),bridgingTask:instruction,reviewNotes:JSON.stringify(['本记录为演示样例，未调用模型，不用于课堂效果统计。','请确认实际硬件、参数和评分量规；当前仅作定性排查。']),rawResponse:'',status:'manual_pending',promptVersion:'demo-v1',graphVersion:hashToken(JSON.stringify(constraint.points)).slice(0,16),constraintSnapshot:JSON.stringify({points:constraint.points.map(({id,name,chapter})=>({id,name,chapter})),edges:constraint.edges}),taskPackJson:JSON.stringify(buildPracticePack(sample.id,instruction,point)),configSnapshot:'{}',rubricSnapshot:'[]',assessmentJson:'[]'}});
 }
 console.log(`已保留归档记录 ${archived.count} 条，并建立3条独立演示记录。演示学习卡在 tmp/demo-student-access.txt。`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
