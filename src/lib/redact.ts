/** Redact before persistence and model submission; hit logs never include originals. */
export interface RedactionHit { rule: string; count: number }
export interface RedactionResult { text: string; hits: RedactionHit[] }

interface RedactionRule {
  name: string;
  pattern: RegExp;
  placeholder: string;
  preserveTechnicalNumber?: boolean;
}

const REDACTION_RULES: readonly RedactionRule[] = [
  {
    name: 'signature_comment',
    pattern: /(?:\/\/|;|\/\*|\*)[ \t]*(?:作者|姓名|学号|班级|author|written\s+by|student\s*(?:id|name)|name)[ \t]*[:：=]?[ \t]*[^\r\n*]+/gi,
    placeholder: '[已脱敏·身份信息]',
  },
  {
    name: 'labeled_identity',
    pattern: /(?:姓名|学号|学生姓名|学生编号|班级|author|name|student\s*(?:id|name)|student_id|student_number)\s*[:：=]?\s*[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff _-]{0,39}(?=[，。；,;\n\r]|$)/gi,
    placeholder: '[已脱敏·身份信息]',
  },
  {
    name: 'self_identity',
    pattern: /(?:我叫|我的名字是|本人姓名(?:是|为))\s*[\u4e00-\u9fff]{2,4}?(?=[，。；,;\s]|现在|正在|想|在|学号|定时|中断|串口|$)|(?:我(?:是|名为))\s*[\u4e00-\u9fff]{2,4}(?=[，。；,;\s]|同学|学号|$)|\bmy\s+name\s+is\s+[A-Za-z][A-Za-z'-]*(?:[ \t]+[A-Za-z][A-Za-z'-]*){0,3}(?=[,.;\r\n]|$)/gi,
    placeholder: '[已脱敏·姓名自述]',
  },
  { name: 'id_card', pattern: /\b\d{17}[\dXx]\b/g, placeholder: '[已脱敏·身份证]', preserveTechnicalNumber: true },
  { name: 'phone', pattern: /\b1[3-9]\d{9}\b/g, placeholder: '[已脱敏·手机号]', preserveTechnicalNumber: true },
  { name: 'email', pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/g, placeholder: '[已脱敏·邮箱]' },
  { name: 'student_id', pattern: /\b(?:(?=[A-Za-z0-9]{8,20}\b)(?=[A-Za-z0-9]*[A-Za-z])(?=(?:[A-Za-z]*\d){6})[A-Za-z0-9]+|\d{8,14})\b/g, placeholder: '[已脱敏·学号]', preserveTechnicalNumber: true },
];

function technicalNumber(text: string, offset: number, token: string): boolean {
  const before = text.slice(Math.max(0, offset - 48), offset);
  const after = text.slice(offset + token.length, offset + token.length + 24);
  // A unit or a technical assignment provides context; a bare long number does not.
  return /^0x[\da-f]+$/i.test(token)
    || /^\s*(?:[kmg]?hz|赫兹|纳秒|微秒|毫秒|时钟周期)(?![a-z])/i.test(after)
    || /(?:晶振(?:频率)?|时钟(?:频率)?|频率|fosc|f_cpu|sysclk|clock(?:_hz)?|frequency|oscillator)[ \t]*(?:[:：=]|为|是)?[ \t]*$/i.test(before);
}

export function redactText(raw_text: string): RedactionResult {
  let working_text = raw_text;
  const hits: RedactionHit[] = [];
  for (const rule of REDACTION_RULES) {
    let count = 0;
    working_text = working_text.replace(rule.pattern, (match: string, offset: number, original: string) => {
      if (rule.preserveTechnicalNumber && technicalNumber(original, offset, match)) return match;
      count += 1;
      if (rule.name === 'signature_comment') {
        const marker = match.match(/^(?:\/\/|;|\/\*|\*)/)?.[0] ?? '//';
        return `${marker} ${rule.placeholder}`;
      }
      return rule.placeholder;
    });
    if (count) hits.push({ rule: rule.name, count });
  }
  return { text: working_text, hits };
}

export function redactSubmission(symptom_text: string, code_text: string): { symptom: string; code: string; hits: RedactionHit[] } {
  const symptom = redactText(symptom_text);
  const code = redactText(code_text);
  const counts = new Map<string, number>();
  for (const hit of [...symptom.hits, ...code.hits]) counts.set(hit.rule, (counts.get(hit.rule) ?? 0) + hit.count);
  return { symptom: symptom.text, code: code.text, hits: [...counts].map(([rule, count]) => ({ rule, count })) };
}
