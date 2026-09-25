export const COURSEWARE = [
  { slug: 'interrupt', number: '01', title: '外部中断通路', subtitle: '按键到中断服务程序', source: '实验四：外部中断与按键；第五章中断系统课件', relatedLabs: [4], question: '按下 K，为什么数码管没有加 1？' },
  { slug: 'timer', number: '02', title: '定时器计数与溢出', subtitle: '初值、溢出和完整周期', source: '实验三；第五章定时/计数器课件', relatedLabs: [3], question: '50 ms 的初值为何不能直接当作 2 s 方波周期？' },
  { slug: 'serial', number: '03', title: '串行帧与波特率', subtitle: '起始位、数据位与采样节奏', source: '串行通信课件；串口乱码专项诊疗', relatedLabs: [], question: '接收端为什么可能读出乱码？' },
  { slug: 'port', number: '04', title: '端口与流水灯', subtitle: '位序、极性和显示顺序', source: '实验二：流水灯；第二章并行 I/O 课件', relatedLabs: [2], question: '端口写入后，哪一盏灯应亮？' },
  { slug: 'scan', number: '05', title: '八位数码管扫描', subtitle: '逐位选通与整屏刷新', source: '实验五、实验七；第九章人机接口课件', relatedLabs: [5, 7], question: '单个位的停留时间与整屏周期有什么区别？' },
  { slug: 'pwm', number: '06', title: 'PWM 与步进相序', subtitle: '占空比与驱动匹配核对', source: '实验八：电机控制；系统开发课件版本待教师确认', relatedLabs: [8], question: '0.3 与 0.7 占空比如何体现在控制信号上？' },
] as const;

export type CoursewareSlug = typeof COURSEWARE[number]['slug'];
export function coursewareForLab(labId: number) { return COURSEWARE.filter(item => (item.relatedLabs as readonly number[]).includes(labId)); }
