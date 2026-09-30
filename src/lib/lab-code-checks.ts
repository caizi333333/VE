/** Bounded source checks, not an assembler, runtime trace or hardware diagnosis. */
import { SUPPORTED_8051_MNEMONICS } from './assembly-labs';

export const LAB_CODE_CHECK_VERSION = '8051-source-checks-v1';
export interface CodeEvidence { line: number; text: string }
export interface LabCodeFinding {
  rule: string;
  title: string;
  instruction: string;
  evidence: CodeEvidence[];
}
export interface LabCodeAnalysis {
  version: string;
  status: 'empty' | 'unsupported' | 'checked';
  summary: string;
  findings: LabCodeFinding[];
}
interface Statement extends CodeEvidence { op: string; args: string[] }
const LIMIT = 256;
const jumps = new Set(['SJMP', 'LJMP', 'AJMP']);
const branches = new Set(['JZ', 'JNZ', 'JC', 'JNC', 'JB', 'JNB', 'JBC', 'DJNZ', 'CJNE']);
const vectors = new Map([[3, 'INT0'], [11, 'T0'], [19, 'INT1'], [27, 'T1'], [35, '串口'], [43, 'T2']]);
const flags: Record<string, { register: string; mask: number }> = {
  EA: { register: 'IE', mask: 128 }, EX0: { register: 'IE', mask: 1 }, ET0: { register: 'IE', mask: 2 }, TR0: { register: 'TCON', mask: 16 },
};

/** Preserve line numbers while ignoring comments and quoted data, including ';' in strings. */
function maskNonCode(code: string): string {
  let result = '', block = false, comment = false, quote = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i], next = code[i + 1];
    if (c === '\n') { result += c; comment = false; continue; }
    if (comment) { result += ' '; continue; }
    if (block) {
      if (c === '*' && next === '/') { result += '  '; i++; block = false; }
      else result += ' ';
      continue;
    }
    if (quote) {
      if (c === '\\' && next && next !== '\n') { result += '  '; i++; }
      else { if (c === quote) quote = ''; result += ' '; }
      continue;
    }
    if (c === ';' || c === '/' && next === '/') { comment = true; result += ' '; }
    else if (c === '/' && next === '*') { block = true; result += '  '; i++; }
    else if (c === '"' || c === "'") { quote = c; result += ' '; }
    else result += c;
  }
  return result;
}
function literal(text = ''): number | undefined {
  const value = text.replace(/^#/, '').trim();
  if (/^0X[\dA-F]+$/i.test(value)) return Number.parseInt(value.slice(2), 16);
  if (/^\d[\dA-F]*H$/i.test(value)) return Number.parseInt(value.slice(0, -1), 16);
  if (/^[01]+B$/i.test(value)) return Number.parseInt(value.slice(0, -1), 2);
  if (/^\d+D?$/i.test(value)) return Number.parseInt(value, 10);
  return undefined;
}
function targetName(text = ''): string {
  if (text === 'IE.7' || literal(text) === 175) return 'EA';
  if (text === 'IE.0' || literal(text) === 168) return 'EX0';
  if (text === 'IE.1' || literal(text) === 169) return 'ET0';
  if (text === 'TCON.4' || literal(text) === 140) return 'TR0';
  return text;
}
function registerName(text = ''): string {
  if (literal(text) === 168) return 'IE';
  if (literal(text) === 136) return 'TCON';
  return text;
}
function evidence(...items: Statement[]): CodeEvidence[] {
  return [...new Map(items.map(item => [item.line, { line: item.line, text: item.text }])).values()];
}
function finding(rule: string, title: string, instruction: string, items: CodeEvidence[]): LabCodeFinding {
  return { rule, title, instruction: `代码第 ${items.map(item => item.line).join('、')} 行：${instruction}`, evidence: items };
}

export function analyzeLabCode(labId: number, code: string): LabCodeAnalysis {
  const result = (status: LabCodeAnalysis['status'], summary: string, findings: LabCodeFinding[] = []): LabCodeAnalysis => ({ version: LAB_CODE_CHECK_VERSION, status, summary, findings });
  if (!code.trim()) return result('empty', '未提交代码，使用课程核对单；补充初始化、入口和问题相关片段后再查。');
  const masked = maskNonCode(code);
  if (/[{}=]|^\s*#\s*(?:include|define)|\b(?:void|sbit|sfr)\b/im.test(masked)) {
    return result('unsupported', '本轮仅检查直接写出的 8051 汇编，不分析 C 程序或其他语言；请由教师核对。');
  }
  if (/\b(?:EQU|MACRO|ENDM|INCLUDE|IF|IFDEF|ELSE|ENDIF)\b|^\s*\$|\b\w+\s+(?:BIT|DATA|IDATA|XDATA|SET)\b/im.test(masked)) {
    return result('unsupported', '代码含符号定义、宏、包含文件或条件汇编，当前检查未展开这些内容；请对照编译结果核对。');
  }
  const source = code.split('\n'), statements: Statement[] = [], labels = new Map<string, number>();
  let ambiguous = false;
  masked.split('\n').forEach((line, index) => {
    let body = line.trim().toUpperCase();
    if (!body) return;
    const label = body.match(/^([\w.$?]+):\s*/);
    if (label) {
      if (labels.has(label[1])) ambiguous = true;
      labels.set(label[1], statements.length);
      body = body.slice(label[0].length);
    }
    if (!body) return;
    const match = body.match(/^\.?([A-Z]+)\b\s*(.*)$/);
    statements.push({ line: index + 1, text: (source[index] ?? '').trim().slice(0, 240), op: match?.[1] ?? '?', args: match?.[2] ? match[2].split(',').map(value => value.trim()) : [] });
  });
  if (ambiguous) return result('unsupported', '代码有重复标签，无法可靠跟踪跳转；请先修复汇编错误。');
  if (!statements.some(statement => SUPPORTED_8051_MNEMONICS.has(statement.op) || statement.op === 'ORG')) {
    return result('unsupported', '未识别出支持的 8051 汇编片段；请补充代码并核对语言与工具链。');
  }
  const entries = new Map<number, number>();
  statements.forEach((statement, index) => {
    if (statement.op !== 'ORG') return;
    const address = literal(statement.args[0]);
    if (address !== undefined && (address === 0 || vectors.has(address))) {
      if (entries.has(address)) ambiguous = true;
      entries.set(address, index);
    }
  });
  if (ambiguous) return result('unsupported', '同一入口地址有多处 ORG，当前检查不能确定有效入口；请先核对汇编布局。');
  const destination = (statement: Statement, index: number) => statement.args.at(-1) === '$' ? index : labels.get(statement.args.at(-1) ?? '');
  const findings: LabCodeFinding[] = [];
  // Follow interrupt-level jumps only. A called helper's RET is not an ISR exit.
  for (const [address, entry] of entries) {
    if (!vectors.has(address)) continue;
    const queue = [entry + 1], visited = new Set<number>();
    while (queue.length && visited.size < LIMIT) {
      const index = queue.pop()!;
      if (visited.has(index)) continue;
      visited.add(index);
      const statement = statements[index];
      if (!statement || !SUPPORTED_8051_MNEMONICS.has(statement.op) || ['END', 'RETI'].includes(statement.op)) continue;
      if (statement.op === 'RET') {
        const items = evidence(statements[entry], statement);
        findings.push(finding(`isr-ret-${address}-${statement.line}`, `${vectors.get(address)} 中断路径出现 RET`, '从该中断入口沿可识别跳转可到达 RET。核对它是否作为中断出口；中断出口须用 RETI 通知中断控制器结束服务，普通被调用子程序的 RET 不要一并替换。修改后在相同条件下重复触发，记录能否再次进入。', items));
        continue;
      }
      if (jumps.has(statement.op) || branches.has(statement.op)) {
        const next = destination(statement, index);
        if (next !== undefined) queue.push(next);
        if (jumps.has(statement.op)) continue;
      }
      if (statement.op !== 'JMP') queue.push(index + 1);
    }
  }

  // Only inspect a straight reset path ending in an explicit self-loop. Do not
  // infer missing enables, expand calls/branches or assume source order is execution order.
  const states = new Map<string, { value: boolean; at: Statement }>();
  const reset = entries.get(0);
  let index = reset === undefined ? undefined : reset + 1, idle: Statement | undefined;
  const visited = new Set<number>();
  while (index !== undefined && !visited.has(index) && visited.size < LIMIT) {
    visited.add(index);
    const statement: Statement | undefined = statements[index];
    if (!statement || !SUPPORTED_8051_MNEMONICS.has(statement.op) || ['END', 'RET', 'RETI', 'JMP', 'ACALL', 'LCALL'].includes(statement.op) || branches.has(statement.op)) break;
    if (jumps.has(statement.op)) {
      const next = destination(statement, index);
      if (next === index) idle = statement;
      index = next;
      continue;
    }
    const bit = targetName(statement.args[0]), register = registerName(statement.args[0]);
    if (flags[bit]) {
      const previous = states.get(bit)?.value;
      const value = statement.op === 'SETB' ? true : statement.op === 'CLR' ? false : statement.op === 'CPL' && previous !== undefined ? !previous : undefined;
      if (value !== undefined) states.set(bit, { value, at: statement });
      else if (['MOV', 'CPL', 'POP'].includes(statement.op)) states.delete(bit);
    }
    const affectedRegister = statement.op === 'XCH' ? registerName(statement.args[1]) : register;
    if (['IE', 'TCON'].includes(affectedRegister) && ['MOV', 'ANL', 'ORL', 'XRL', 'POP', 'INC', 'DEC', 'XCH'].includes(statement.op)) {
      const raw = statement.args[1]?.startsWith('#') ? literal(statement.args[1]) : undefined;
      const value = raw !== undefined && raw <= 255 ? raw : undefined;
      for (const [name, flag] of Object.entries(flags)) {
        if (flag.register !== affectedRegister) continue;
        const old = states.get(name)?.value, set = value === undefined ? undefined : !!(value & flag.mask);
        const updated = value === undefined ? undefined : statement.op === 'MOV' ? set : statement.op === 'ANL' ? set === false ? false : old : statement.op === 'ORL' ? set === true ? true : old : statement.op === 'XRL' && set !== undefined && old !== undefined ? set !== old : undefined;
        if (updated !== undefined) states.set(name, { value: updated, at: statement });
        else states.delete(name);
      }
    }
    index++;
  }
  if (idle) {
    const needed: string[] = [];
    if (labId === 4 && entries.has(3)) needed.push('EA', 'EX0');
    if ([3, 5, 7].includes(labId) && entries.has(11)) needed.push('EA', 'ET0');
    if (labId === 3 && statements.some(statement => statement.op === 'MOV' && ['TH0', 'TL0'].includes(statement.args[0]))) needed.push('TR0');
    for (const name of needed) {
      const state = states.get(name);
      if (state?.value !== false) continue;
      const purpose = name === 'TR0' ? 'T0 启动控制' : name === 'EA' ? '总中断允许' : name === 'EX0' ? 'INT0 中断允许' : 'T0 中断允许';
      findings.push(finding(`idle-disabled-${name}`, `等待输入前 ${purpose}关闭`, `沿可识别的复位初始化路径，到达此自循环前 ${name} 被清除。若这里用于等待实验输入，请核对该控制位是否应该启用；若有其他初始化或主动停机设计，请结合完整程序确认。修改后用相同操作复测并记录变化。`, evidence(state.at, idle)));
    }
  }
  const selected = findings.slice(0, 3);
  return result('checked', `${selected.length ? `找到 ${selected.length} 项有代码依据的候选检查。` : '未命中当前支持的代码检查规则，不代表程序正确。'}仅检查直接写出的入口、跳转和部分初始化；不展开子程序、宏或包含文件，不证明路径实际执行、编译通过或实物结果。`, selected);
}
