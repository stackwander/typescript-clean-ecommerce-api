import type { PrismaClient } from '@prisma/client';
export async function assertDatabaseContract(db: PrismaClient): Promise<void> {
  const result = (await db.$runCommandRaw({ find: '_schema', filter: { _id: 'shop' } })) as {
    cursor?: { firstBatch?: { version: number }[] };
  };
  if (result.cursor?.firstBatch?.[0]?.version !== 2)
    throw new Error(
      'Database contract is not version 2; run guarded setup or follow the upgrade guide',
    );
}
