import { prisma } from '@/lib/db';
import { HttpError, requireTeacher, withErrors } from '@/lib/auth';
import { ownedClassroom, toTeacherDiagnosis } from '@/lib/teacher-data';
import { parseDateRange } from '@/lib/stats';
import { publishedPayload, readJson, type PublishedPayload } from '@/lib/ticket-view';
import { redactSubmission } from '@/lib/redact';
export const dynamic='force-dynamic';
const clean=(value:string)=>redactSubmission(value,'').symptom;
const sourceLabels:Record<string,string>={demo:'演示',test:'测试',classroom:'课堂',legacy_unknown:'历史待核实'};
function asMarkdown(markdown:string,filename:string){return new Response(markdown,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${filename}"`}});}
export const GET=withErrors(async(request:Request)=>{
  const teacher=await requireTeacher(request);
  const params=new URL(request.url).searchParams;
  const kind=params.get('kind') ?? 'weekly-log';
  if(kind==='case') {
    const id=params.get('id');if(!id)throw new HttpError(400,'请选择诊疗记录');
    const record=await prisma.diagnosis.findUnique({where:{id},include:{review:true,revisions:{orderBy:{version:'asc'}},attempts:{orderBy:{createdAt:'asc'}}}});
    if(!record?.classroomId)throw new HttpError(404,'诊疗记录不存在');
    const classroom=await ownedClassroom(teacher.id,record.classroomId);
    const experiment=record.experimentId?await prisma.experiment.findUnique({where:{id:record.experimentId}}):null;
    const view=toTeacherDiagnosis(record,experiment?.name);
    const published=publishedPayload(record);
    const lines=[`# 诊疗案例记录 · ${record.ticket}`,'',`数据来源：${sourceLabels[record.dataSource] ?? record.dataSource}；班级：${clean(classroom.name)}；实验：${clean(experiment?.name ?? '未关联')}`,
      `记录时间：${record.createdAt.toISOString()}；提示词版本：${record.promptVersion}；图谱版本：${record.graphVersion}`,'',
      '## 现象与初始代码','',clean(record.symptomText),'', '```c',clean(record.codeText),'```','',
      '## 工具与实验条件','',`提供方：${record.provider || '未调用成功'}；模型：${record.model || '无'}`,'',`实验配置：${clean(record.configSnapshot)}`,'',
      '## 模型初稿（仅供教师核对）','',clean(record.classification),...view.original.checkpoints.map(c=>`- [${c.point_id}] ${clean(c.instruction)}`),clean(view.original.bridging_task),'',
      '## 实际下发','',published?`当前发布版本：${published.revision.version}；发布时间：${published.revision.createdAt.toISOString()}`:'当前没有可向学生提供的已批准内容。'];
    for(const revision of record.revisions.filter(r=>r.action==='release')) {
      const payload=readJson<PublishedPayload|null>(revision.payloadJson,null);if(!payload)continue;
      lines.push('',`### 第 ${revision.round} 轮 · 发布版本 ${revision.version}`,`时间：${revision.createdAt.toISOString()}`,...payload.checkpoints.map(c=>`- [${c.point_id}] ${clean(c.instruction)}`),`基础任务：${clean(payload.bridging_task)}`,`教师说明：${clean(payload.comment)}`,'','三级任务：',...payload.tasks.map(t=>`${t.level}. ${clean(t.title)}；目标：${clean(t.objective ?? '')}；条件：${clean(t.conditions ?? '')}；提交物：${clean(t.deliverable ?? '')}；验证：${clean(t.verification ?? '')}`),'','分项评价：',...payload.assessments.map(a=>`- ${a.criterion_id}：${a.score ?? '未评分'}；${clean(a.reason)}`));
    }
    lines.push('','## 多轮修订与验证','');
    for(const round of view.rounds)lines.push(clean(JSON.stringify(round)),'');
    for(const attempt of record.attempts)lines.push(`级别 ${attempt.level}；发布版本 ${attempt.publishedVersion}；提交时间 ${attempt.createdAt.toISOString()}`,`学生自报：${attempt.outcome}；教师验证状态：${attempt.status}`,clean(attempt.observation),'```c',clean(attempt.codeText),'```',`教师反馈：${clean(attempt.teacherFeedback) || '未记录'}`,`验证依据：${clean(attempt.verificationEvidence) || '未记录'}`,'');
    lines.push('## 应用效果','',record.completedAt?`教师在 ${record.completedAt.toISOString()} 确认三级任务完成。`:'尚无三级任务全部通过教师验证的记录。','未提供对照测评，不能据此推断教学效果提升。','','## 学生反馈','','未提供独立学生反馈材料；任务观察仅见上述回执。');
    return asMarkdown(lines.join('\n'),`case-${record.ticket}.md`);
  }
  if(kind!=='weekly-log')throw new HttpError(400,'不支持的导出类型');
  const classroomId=params.get('classroom_id');if(!classroomId)throw new HttpError(400,'请选择班级');
  const classroom=await ownedClassroom(teacher.id,classroomId);
  const range=parseDateRange(params);if(!range.from || !range.to)throw new HttpError(400,'请提供起止日期');
  const experimentId=params.get('experiment_id');
  const labId=params.get('lab_id');
  if(labId && !/^[1-8]$/.test(labId))throw new HttpError(400,'实验编号不合法');
  if(labId && experimentId)throw new HttpError(400,'请只选择一项实验');
  if(experimentId && !await prisma.experiment.findFirst({where:{id:experimentId,classroomId}}))throw new HttpError(404,'实验不存在');
  const records=await prisma.diagnosis.findMany({where:{classroomId,dataSource:classroom.dataSource,...(experimentId?{experimentId}:{}),...(labId?{faultChainId:`lab-${labId}`}:{})},select:{id:true,ticket:true,experimentId:true}});
  const ids=records.map(r=>r.id);
  const events=await prisma.activityEvent.findMany({where:{classroomId,dataSource:classroom.dataSource,createdAt:range.where,diagnosisId:{in:ids}},orderBy:{createdAt:'asc'}});
  const ticketMap=new Map(records.map(r=>[r.id,r.ticket]));
  const kinds:Record<string,string>={submission:'提交',generation_completed:'模型结果入库',generation_failed:'转人工处理',review_saved:'保存复核稿',released:'教师下发',rejected:'退回',help:'求助',attempt_submitted:'任务回执',verified:'教师验证通过',needs_revision:'需要修订',completed:'三级任务完成'};
  const count=(kind:string)=>events.filter(e=>e.kind===kind).length;
  const lines=[`# AI 应用日志 · ${params.get('from')} 至 ${params.get('to')}`,'',`班级：${clean(classroom.name)}；数据来源：${sourceLabels[classroom.dataSource] ?? classroom.dataSource}`,
    '时间范围按北京时间筛选各事件的实际发生时间；演示、测试和历史待核实数据分别保留来源标记。','',
    `- 提交事件：${count('submission')} 次`, `- 教师下发：${count('released')} 次`,`- 学生求助：${count('help')} 次`,`- 教师验证通过：${count('verified')} 次`,`- 三级任务完成：${count('completed')} 次`,
    `- 有事件记录的匿名学习编号：${new Set(events.flatMap(e=>e.learnerId?[e.learnerId]:[])).size} 个（不等同自然人数）`,'',
    '## 事件明细','',...events.map(e=>`- ${e.createdAt.toISOString()} · ${kinds[e.kind] ?? e.kind} · 单号 ${ticketMap.get(e.diagnosisId ?? '') ?? '无'} · ${clean(e.payloadJson)}`),'',
    '## 课堂条件与待补材料','',`审查记录：${clean(classroom.reviewReference) || '未填写'}`,'参与人数核对、教学效果与学生反馈须由任课教师依据实际材料补充。'];
  return asMarkdown(lines.join('\n'),`weekly-log-${params.get('from')}.md`);
});
