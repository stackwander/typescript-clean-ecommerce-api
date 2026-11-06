import { Prisma, PrismaClient } from '@prisma/client';
import { setTimeout } from 'node:timers/promises';
import { conflict } from '../../ca_domain/errors';
export async function transaction<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(work, { maxWait: 5000, timeout: 15000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034')
        throw error;
      if (attempt === 3) throw conflict('Concurrent change; retry the request');
      await setTimeout(20 * (attempt + 1) + Math.random() * 30);
    }
  }
  throw conflict('Concurrent change; retry the request');
}
