/**
 * Prisma 客户端单例。
 *
 * 开发模式下 Next.js 会热重载模块，每次新建客户端会耗尽连接，因此挂到
 * globalThis 上复用。
 */

import { PrismaClient } from '@prisma/client';

const global_with_prisma = globalThis as unknown as { prisma_client?: PrismaClient };

export const prisma =
  global_with_prisma.prisma_client ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global_with_prisma.prisma_client = prisma;
}
