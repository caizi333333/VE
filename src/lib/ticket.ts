/**
 * 诊疗单号。给学生用来取回教师下发结果，不对应学号或账号。
 *
 * 申报书要求不建学生身份表。课堂里学生报一下单号、或扫自己屏幕上的号即可，
 * 不必登录。
 */

import { prisma } from './db';

const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TICKET_LENGTH = 6;

/**
 * 生成一个尚未占用的 6 位单号。
 *
 * @returns 大写单号
 */
export async function allocateTicket(): Promise<string> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const ticket = randomTicket();
    const existing = await prisma.diagnosis.findUnique({ where: { ticket } });
    if (!existing) return ticket;
  }
  throw new Error('无法分配诊疗单号，请重试');
}

/**
 * 把用户输入收成规范单号。
 *
 * @param raw_value 输入
 * @returns 大写单号，格式不对时返回空串
 */
export function normalizeTicket(raw_value: string): string {
  return raw_value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * 随机单号，不含易混字符 0/O/1/I。
 *
 * @returns 6 位单号
 */
function randomTicket(): string {
  const bytes = new Uint8Array(TICKET_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => TICKET_ALPHABET[byte % TICKET_ALPHABET.length]).join('');
}
