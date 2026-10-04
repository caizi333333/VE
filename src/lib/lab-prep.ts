/** 课前预习单：每实验一份"看课件 + 跑示例 + 答两题"的回执。题目挂课程知识图谱锚点。 */

export interface PrepQuestion {
  id: string;
  /** 课程知识图谱节点，例如 6.3.2 */
  point: string;
  prompt: string;
}

export interface LabPrep {
  labId: number;
  coursewareSlug: 'isa' | 'port' | 'timer' | 'interrupt' | 'scan' | 'buzzer' | 'pwm' | 'serial';
  coursewareTitle: string;
  /** 预习时建议运行哪个预置程序、看什么现象 */
  runStep: string;
  questions: PrepQuestion[];
}

export const LAB_PREP: LabPrep[] = [
  {
    labId: 1,
    coursewareSlug: 'isa',
    coursewareTitle: '指令执行与堆栈透视',
    runStep: '运行“指令与堆栈单步”示例，单步观察 PUSH 后 A 与 RAM 30H 的变化。',
    questions: [
      { id: 'q1', point: '3.2.4', prompt: 'PUSH 30H 之后又 PUSH 41H，接着 POP 42H：41H 和 42H 里最后各是什么？为什么说堆栈是“后进先出”？' },
      { id: 'q2', point: '3.1.5', prompt: 'MOVC A,@A+DPTR 里 A 起什么作用？这属于哪种寻址方式？' },
    ],
  },
  {
    labId: 2,
    coursewareSlug: 'port',
    coursewareTitle: '端口与流水灯',
    runStep: '运行流水灯示例，看 P1 各位高低变化；再切“2025 备课·分组点亮”变体对比。',
    questions: [
      { id: 'q1', point: '3.5.2', prompt: '流水灯为什么多用 RL/RR 循环移位，而不是对端口值做加法？' },
      { id: 'q2', point: '3.5.2', prompt: 'DJNZ 构成的软件延时，延时长短由哪两个量决定？' },
    ],
  },
  {
    labId: 3,
    coursewareSlug: 'timer',
    coursewareTitle: '定时器计数与溢出',
    runStep: '运行 T0 示例后点“继续观察”再推进一次，看 P0.0 何时第一次翻转。',
    questions: [
      { id: 'q1', point: '6.3.2', prompt: '中断服务程序里为什么要重装 TH0/TL0？不重装会发生什么？' },
      { id: 'q2', point: '5.2.2', prompt: 'ET0、EA、TR0 三个位各管什么？漏开任何一个，中断会怎样？' },
    ],
  },
  {
    labId: 4,
    coursewareSlug: 'interrupt',
    coursewareTitle: '外部中断通路',
    runStep: '运行 INT0 示例，按一次虚拟 P3.2 键，看 RAM 30H 与 P1 的变化。',
    questions: [
      { id: 'q1', point: '5.3.3', prompt: 'EX0、EA、IT0 三个位各管什么？IT0 决定的是哪种触发方式？' },
      { id: 'q2', point: '8.2.3', prompt: '按键“按一次记好几下”是什么现象造成的？实验里怎么判断？' },
    ],
  },
  {
    labId: 5,
    coursewareSlug: 'scan',
    coursewareTitle: '八位数码管扫描',
    runStep: '运行校正版扫描示例，看调试台的七段字形依次点亮 0–7。',
    questions: [
      { id: 'q1', point: '8.1.2', prompt: '段码和位选分别走哪个端口？动态扫描为什么必须“轮流点”？' },
      { id: 'q2', point: '6.3.1', prompt: '扫描间隔太快或太慢，肉眼分别看到什么现象？' },
    ],
  },
  {
    labId: 6,
    coursewareSlug: 'buzzer',
    coursewareTitle: '蜂鸣器：节奏与音高',
    runStep: '运行 S61 间断发声示例，看调试台的控制脚节奏解读。',
    questions: [
      { id: 'q1', point: '8.6.1', prompt: '有源和无源蜂鸣器的驱动差别是什么？本实验程序对应哪一种？' },
      { id: 'q2', point: '8.6.1', prompt: '把第二段延时改长或改短，对有源和无源器件分别改变什么？' },
    ],
  },
  {
    labId: 7,
    coursewareSlug: 'scan',
    coursewareTitle: '八位数码管扫描',
    runStep: '运行电子时钟示例，看十位/个位刷新，再切扩展报警版对比。',
    questions: [
      { id: 'q1', point: '6.3.5', prompt: '单次定时到不了 1 秒时，程序里怎么凑出“秒”？' },
      { id: 'q2', point: '8.1.2', prompt: '电子时钟的显示为什么也用扫描程序，而不是一直点亮？' },
    ],
  },
  {
    labId: 8,
    coursewareSlug: 'pwm',
    coursewareTitle: 'PWM 与步进相序',
    runStep: '运行 PWM 示例看 P1.0 通断比例；再切八态相序看四路输出轮换。',
    questions: [
      { id: 'q1', point: '6.3.3', prompt: 'PWM 占空比改变的是什么？对电机和 LED 分别意味着什么？' },
      { id: 'q2', point: '8.5.2', prompt: '八拍相序为什么不能乱序？颠倒顺序电机可能怎样？' },
    ],
  },
];

export function labPrep(labId: number): LabPrep | undefined {
  return LAB_PREP.find((p) => p.labId === labId);
}

export interface PrepPayload {
  lab_id: number;
  courseware_done: boolean;
  example_done: boolean;
  answers: { id: string; point: string; prompt: string; answer: string }[];
}

export interface PrepView extends PrepPayload {
  submitted_at: string;
  learner_number?: string;
}
