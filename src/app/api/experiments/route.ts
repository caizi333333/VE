import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertSameOrigin, getLearner, getTeacher, HttpError, requireTeacher, withErrors } from '@/lib/auth';
import { calculateExperiment } from '@/lib/calculations';
import { experimentView } from '@/lib/classroom-view';
const configSchema = z.object({ chip: z.string().trim().max(100).optional(), clock_hz: z.number().positive().max(1e9).optional(), clocks_per_tick: z.number().positive().max(1024).optional(), timer_mode: z.union([z.literal(1),z.literal(2)]).optional(), target_ms: z.number().positive().max(3600000).optional(), target_baud: z.number().positive().max(10000000).optional(), smod: z.union([z.literal(0),z.literal(1)]).optional(), verification_method: z.string().trim().max(1000).optional(), time_definition: z.enum(['单次溢出间隔']).optional(), tolerance_percent: z.number().min(0).max(100).optional(), toolchain: z.string().trim().max(200).optional(), benches: z.array(z.string().regex(/^[A-Z][0-9]{1,3}$/, '工位格式为A1等')).max(200).optional() });
const schema = z.object({ classroom_id: z.string().min(1), id: z.string().optional(), expected_version: z.number().int().positive().optional(), name: z.string().trim().min(1).max(100), fault_chain_id: z.enum(['timer-isr-not-entered','uart-garbled','timing-inaccurate']), config: configSchema, rubric: z.array(z.object({ id:z.string().min(1).max(60),label:z.string().trim().min(1).max(100),max_score:z.number().positive().max(100),criterion:z.string().trim().min(1).max(1000) })).max(20), confirmed: z.boolean() });
export const GET = withErrors(async (request: Request) => {
  const learner = await getLearner(request); const teacher = await getTeacher(request);
  const id = new URL(request.url).searchParams.get('classroom_id');
  if (!learner && !teacher) throw new HttpError(401,'请先进入课堂');
  const classroomId = teacher && id ? id : learner?.classroomId;
  if (!classroomId) return NextResponse.json({ experiments: [] });
  const c = await prisma.classroom.findFirst({where:{id:classroomId,...(teacher && id ? {teacherId:teacher.id} : {})}});
  if (!c) throw new HttpError(404,'课堂不存在');
  const list = await prisma.experiment.findMany({where:{classroomId},orderBy:{createdAt:'asc'}});
  return NextResponse.json({experiments:list.map(experimentView)});
});
export const POST = withErrors(async (request: Request) => {
  assertSameOrigin(request); const teacher = await requireTeacher(request);
  const p = schema.safeParse(await request.json().catch(()=>null));
  if (!p.success) throw new HttpError(400,p.error.issues[0]?.message ?? '实验配置无效');
  const input=p.data;
  const c=await prisma.classroom.findFirst({where:{id:input.classroom_id,teacherId:teacher.id}});
  if(!c) throw new HttpError(404,'课堂不存在');
  if(new Set(input.rubric.map(x=>x.id)).size!==input.rubric.length) throw new HttpError(400,'评分项编号不能重复');
  if(input.confirmed) {
    const cfg=input.config;
    if(!cfg.chip || !cfg.clock_hz || !cfg.clocks_per_tick || !cfg.timer_mode || !cfg.verification_method || !cfg.toolchain || !input.rubric.length) throw new HttpError(400,'确认前请填写芯片、时钟、分频、模式、验证方式、工具及评分量规');
    if(input.fault_chain_id==='uart-garbled' ? (!cfg.target_baud || cfg.smod===undefined || cfg.timer_mode!==2) : (!cfg.target_ms || !cfg.time_definition || cfg.timer_mode!==1)) throw new HttpError(400,'请确认本实验的目标参数和受支持的定时模式');
    const results = calculateExperiment(cfg,input.fault_chain_id);
    if(results.some(r=>r.status!=='ready')) throw new HttpError(400,results.find(r=>r.status!=='ready')?.summary ?? '实验计算参数尚未确认');
    if(cfg.tolerance_percent===undefined) throw new HttpError(400,'确认前请填写允许误差');
    if(results.some(r=>typeof r.values?.error_percent==='number' && Math.abs(r.values.error_percent)>cfg.tolerance_percent!)) throw new HttpError(400,'当前参数的量化误差超过允许范围，请核对时钟、目标值与容差');
    if(Math.abs(input.rubric.reduce((n,r)=>n+r.max_score,0)-100)>0.001) throw new HttpError(400,'已确认量规的满分须合计100分');
  }
  const data={name:input.name,faultChainId:input.fault_chain_id,configJson:JSON.stringify(input.config),rubricJson:JSON.stringify(input.rubric),confirmed:input.confirmed};
  if(input.id) {
    if(!input.expected_version) throw new HttpError(400,'缺少实验版本');
    const result=await prisma.experiment.updateMany({where:{id:input.id,classroomId:c.id,version:input.expected_version},data:{...data,version:{increment:1}}});
    if(!result.count) throw new HttpError(409,'实验已更新，请刷新后重试');
    const updated=await prisma.experiment.findUniqueOrThrow({where:{id:input.id}});
    return NextResponse.json({experiment:experimentView(updated)});
  }
  const saved=await prisma.experiment.create({data:{...data,classroomId:c.id}});
  return NextResponse.json({experiment:experimentView(saved)});
});
