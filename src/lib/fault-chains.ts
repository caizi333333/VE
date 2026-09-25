/**
 * 单片机典型故障诊疗库（种子版）。
 *
 * 申报书承诺的"虚拟工程师"按知识依赖链给排查线索，不直接给答案。本文件定义
 * 三类典型故障各自的图谱入口节点、依赖链切片和已知高频易错点，供检索层沿
 * prerequisites 上溯时作锚点，也作为后续三个"七要素"典型案例的种子。
 *
 * 三类故障取自申报书正文原话："如中断不触发、串口通信乱码、定时不准"。
 *
 * 易错点一律标注来源，不凭印象编：
 *   - 'appendix'   来自申报书支撑材料《样例物料》已写明的易错点
 *   - 'graph'      来自课程知识图谱节点的 description / commonMistake 原文
 *   - 'backfill'   教师在实际诊疗中复核后回填（运行期写入，本文件不预置）
 */

/** 易错点的来源，决定它能不能作为对外材料的依据。 */
export type PitfallSource = 'appendix' | 'graph' | 'backfill';

export interface FaultPitfall {
  /** 落到哪个知识图谱节点，便于回填与统计高频易错点分布。 */
  point_id: string;
  /** 一句话描述学生实际会犯的错。 */
  description: string;
  source: PitfallSource;
}

export interface FaultChain {
  id: string;
  /** 故障名，对外材料与案例集标题用这个。 */
  name: string;
  /** 学生可能的口语说法，用于命中本故障链。 */
  symptom_keywords: readonly string[];
  /** 图谱入口节点：现象最先归类到这里。 */
  entry_point_ids: readonly string[];
  /**
   * 依赖链切片，按"最可能出问题→次要"排序。
   * 检索层据此从图谱取节点原文，组装【知识约束】段。
   */
  chain_point_ids: readonly string[];
  known_pitfalls: readonly FaultPitfall[];
}

export const FAULT_CHAINS: readonly FaultChain[] = [
  {
    id: 'timer-isr-not-entered',
    name: '定时器中断不触发',
    symptom_keywords: [
      '中断进不去', '中断不触发', '进不了中断', '不进中断', '中断没反应',
      'ISR', '中断服务', '定时中断', 'LED 不翻转', 'LED不闪',
    ],
    entry_point_ids: ['5.6.2', '5.4.2'],
    chain_point_ids: [
      '5.2.2', // 中断允许寄存器（IE）：EA 总允许 + ET0 使能
      '6.1.2', // TMOD：工作模式选择
      '6.1.3', // TCON：TR0 启动、TF0 溢出标志
      '6.1.4', // 定时器初值计算
      '5.4.1', // 中断请求：标志位置位
      '5.4.2', // 中断响应条件
      '5.4.3', // 中断服务程序
      '5.2.4', // 中断向量表：入口地址 0003H-0023H
    ],
    known_pitfalls: [
      {
        point_id: '5.2.2',
        description: '只开了 EA 总允许位，漏开 ET0 定时器0中断使能位。',
        source: 'appendix',
      },
      {
        point_id: '6.2.2',
        description: '方式1为16位非自动重装，溢出后未在中断服务程序内重装 TH0/TL0。',
        source: 'appendix',
      },
      {
        point_id: '6.1.3',
        description: 'TCON 中的 TR0 未置1，定时器根本没有启动计数。',
        source: 'graph',
      },
      {
        point_id: '5',
        description: '在中断服务程序里写很长的代码或调用阻塞函数；ISR 应当短而快，长任务置标志位回主循环处理。',
        source: 'graph',
      },
    ],
  },
  {
    id: 'uart-garbled',
    name: '串口通信乱码',
    symptom_keywords: [
      '串口乱码', '通信乱码', '收到乱码', '串口不通', '发送乱码',
      '接收乱码', '波特率', '串口通信', '上位机显示乱码',
    ],
    entry_point_ids: ['7.3.1', '7.2.3'],
    chain_point_ids: [
      '7.2.3', // 波特率设置（T1 模式2 产生）
      '6.2.3', // 模式2（8位自动重装）：溢出率是波特率直接来源
      '2.4.1', // 时钟电路：晶振频率
      '2.4.2', // 机器周期换算
      '7.1.3', // 波特率概念与误差
      '7.2.1', // SCON：SM0/SM1/REN/TI/RI
      '7.2.4', // 串口工作模式
      '7.3.1', // 串口初始化
    ],
    known_pitfalls: [
      {
        point_id: '7',
        description: '波特率没算清楚：T1 模式2、SMOD 位、晶振频率三件事任一项错都会乱码。',
        source: 'graph',
      },
      {
        point_id: '7.2.3',
        description: '按 12MHz 晶振套用 11.0592MHz 的标准初值表，波特率产生固有误差。',
        source: 'graph',
      },
      {
        point_id: '7.2.1',
        description: 'SM0/SM1 选错工作模式，或接收端未置 REN，收发数据格式对不上。',
        source: 'graph',
      },
    ],
  },
  {
    id: 'timing-inaccurate',
    name: '定时不准',
    symptom_keywords: [
      '定时不准', '定时偏差', '时间不对', '闪烁太快', '闪烁太慢',
      '延时不准', '秒不准', '初值', '定时误差',
    ],
    entry_point_ids: ['6.3.1', '6.1.4'],
    chain_point_ids: [
      '6.1.4', // 定时器初值计算
      '2.4.2', // 机器周期（12T）换算
      '2.4.1', // 时钟电路：实际晶振频率
      '6.1.1', // 加1计数器原理、定时与计数的区别
      '6.2.2', // 模式1：16位非自动重装
      '6.2.3', // 模式2：8位自动重装
      '6.3.1', // 精确延时
      '6.3.5', // 长定时：软件计数器扩展
    ],
    known_pitfalls: [
      {
        point_id: '6.1.4',
        description: '初值公式漏掉实际时钟分频换算，或按错误晶振频率计算 TH/TL。',
        source: 'graph',
      },
      {
        point_id: '6',
        description: '把定时模式与计数模式搞混：定时数的是机器周期，计数数的是 T0/T1 引脚外部脉冲。',
        source: 'graph',
      },
      {
        point_id: '6.3.5',
        description: '单次定时超出当前时钟与分频条件下的计数范围，未用软件计数器扩展。',
        source: 'graph',
      },
    ],
  },
];

/**
 * 按学生描述的现象匹配故障链。
 *
 * 命中策略是关键词计数，命中越多排越前；没有任何命中时返回空数组，交由
 * 上层退回通用图谱检索，不硬套一个故障链。
 *
 * @param symptom_text 学生输入的现象描述与代码片段
 * @returns 命中的故障链，按命中关键词数量降序
 */
export function matchFaultChains(symptom_text: string): FaultChain[] {
  const normalized_text = symptom_text.toLowerCase();

  const scored_chains = FAULT_CHAINS.map((chain) => {
    const hit_count = chain.symptom_keywords.filter((keyword) =>
      normalized_text.includes(keyword.toLowerCase()),
    ).length;
    return { chain, hit_count };
  }).filter((entry) => entry.hit_count > 0);

  scored_chains.sort((left, right) => right.hit_count - left.hit_count);
  return scored_chains.map((entry) => entry.chain);
}

/**
 * 按 id 取故障链。
 *
 * @param chain_id 故障链标识
 * @returns 对应故障链，不存在时返回 undefined
 */
export function getFaultChainById(chain_id: string): FaultChain | undefined {
  return FAULT_CHAINS.find((chain) => chain.id === chain_id);
}
