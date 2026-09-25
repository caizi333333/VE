/** Public help catalogue. No diagnosis drafts, learner records or credentials. */
export const HELP = {
  join: { title: '加入实验课堂', answer: '向任课教师领取学习卡，在学生实验台填写班级码、匿名学习编号和私密恢复码。缺少任意一项时，请联系教师补发；诊疗单号不能代替学习卡。', href: '/', action: '打开学生实验台' },
  recovery: { title: '恢复课堂访问', answer: '忘记恢复码时，请让任课教师在“班级设置”的学习卡管理中重置并重新发放。教师账号由管理员管理。请勿把密码、恢复码或模型密钥发送到这里。', href: '/', action: '返回课堂入口' },
  setup: { title: '准备一堂实验课', answer: '教师登录后，打开“班级设置”：创建班级 → 添加实验 → 确认硬件参数、验证标准和评分量规 → 生成并分发学习卡。真实课堂还需填写审查记录。参数未确认时仅能进行定性排查。', href: '/teacher', action: '打开教师工作台' },
  submit: { title: '描述实验问题', answer: '在学生实验台选实验，按接线、代码或结果方向先自查；仍未解决时写下实际观察，必要时补相关代码。不要填写姓名和学号。提交后保留单号，可在同一诊疗内补充。', href: '/', action: '打开学生实验台' },
  review: { title: '审核与发布指导', answer: '教师在“处理求助”打开待办，对照学生原提交，核对并修改检查草稿、任务与评价。保存仅保留草稿；点击发布后学生才会看到。出现版本冲突时先保留改稿，再刷新对照。', href: '/teacher', action: '打开教师工作台' },
  wait: { title: '理解当前等待状态', answer: '“等待教师审核”表示指导还未发布；“等待教师处理”表示需要人工接管，提交记录仍然保留。学生页面会自动检查更新，也可手动刷新。等待较久请告知教师单号，不要反复新建诊疗。', href: '/', action: '查看学生实验台' },
  tasks: { title: '完成验证与进阶', answer: '先按已发布检查点操作，提交观察、测量依据与修改后的代码。基础任务经教师验证通过后开放综合任务，再通过才开放拓展任务。遇到困难提交求助；自报解决不等于教师确认通过。', href: '/', action: '打开实验任务' },
  stats: { title: '查看课堂记录', answer: '教师在“课堂记录”选择班级、实验与日期。先到班级设置核对有效学习编号和实际参与人数，再确认统计分母。完成比例只计教师确认的结果；演示和历史记录不作为真实课堂成效。', href: '/teacher', action: '打开教师工作台' },
  technical: { title: '转入实验排查', answer: '在学生实验台选择对应实验，先按接线、代码或结果方向查看具体自查步骤；仍未解决时提交实际现象与相关代码。教师审核后发布进一步指导。本助手不会绕过审核提供诊疗答案或实验通过结论。', href: '/', action: '查看实验排查' },
  general: { title: '找到下一步操作', answer: '我可以帮助你加入课堂、准备实验、提交问题、理解审核状态、完成任务或查看统计。请描述卡在哪一步，或选择下面的常见问题。这里不会读取个人诊疗记录。', href: '/', action: '学生实验台' },
} as const;
export type HelpIntent = keyof typeof HELP;
export function matchHelp(message: string): HelpIntent {
  if (/密码|恢复码|密钥|忘记|丢失/.test(message)) return 'recovery';
  if (/TH[01]|TL[01]|0x[\da-f]+|寄存器|中断|串口|定时|代码|诊断|答案|评分|改分|绕过|初稿|system prompt/i.test(message)) return 'technical';
  if (/统计|导出|完成率|周报|分母/.test(message)) return 'stats';
  if (/卡住|进阶|基础任务|综合任务|拓展任务|验证|求助/.test(message)) return 'tasks';
  if (/等待|没回复|没有回复|没反应|模型|失败|超时|429/.test(message)) return 'wait';
  if (/开课|建班|配置|发卡|准备|量规/.test(message)) return 'setup';
  if (/审核|发布|草稿|复核|冲突/.test(message)) return 'review';
  if (/加入|登录|学习卡|班级码/.test(message)) return 'join';
  if (/提交|现象|描述|修订/.test(message)) return 'submit';
  return 'general';
}
