/**
 * 把学生贴出的 8051 代码行落到课程知识节点上。
 *
 * 这是申报书里"常见错误定位到知识点"的浅层实现：按寄存器与关键字对齐，
 * 不替代教师判断，只让学生看见"这段代码在图谱的哪一格"。
 */

export interface CodeMapHit {
  line_no: number;
  text: string;
  point_id: string;
  label: string;
}

const LINE_RULES: readonly { pattern: RegExp; point_id: string; label: string }[] = [
  { pattern: /\bET0\b|\bET1\b|\bEX0\b|\bEX1\b|\bEA\s*=/, point_id: '5.2.2', label: '中断允许 IE' },
  { pattern: /\bTR0\b|\bTR1\b|\bTF0\b|\bTF1\b|\bTCON\b/, point_id: '6.1.3', label: 'TCON 启动/溢出' },
  { pattern: /\bTMOD\b/, point_id: '6.1.2', label: 'TMOD 工作方式' },
  { pattern: /\bTH0\b|\bTL0\b|\bTH1\b|\bTL1\b/, point_id: '6.1.4', label: '定时器初值' },
  { pattern: /\binterrupt\b/i, point_id: '5.4.3', label: '中断服务程序' },
  { pattern: /\bSCON\b|\bREN\b|\bTI\b|\bRI\b/, point_id: '7.2.1', label: 'SCON' },
  { pattern: /\bSBUF\b/, point_id: '7.3.1', label: '串口收发' },
  { pattern: /\bP1_|\bP1\b|\bP0\b|\bP2\b|\bP3\b/, point_id: '4.2.1', label: '并行口' },
];

/**
 * 扫描代码，给能对上节点的行做标注。一行只取最先命中的规则。
 *
 * @param code_text 已脱敏代码
 * @returns 带节点的行
 */
export function mapCodeToPoints(code_text: string): CodeMapHit[] {
  const hits: CodeMapHit[] = [];
  const lines = code_text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    if (!text.trim()) continue;
    const rule = LINE_RULES.find((item) => item.pattern.test(text));
    if (!rule) continue;
    hits.push({
      line_no: index + 1,
      text: text.trim(),
      point_id: rule.point_id,
      label: rule.label,
    });
  }
  return hits;
}
