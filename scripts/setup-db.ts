import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

async function main() {
  const db = new PrismaClient();
  try {
    const result = (await db.$runCommandRaw({ find: '_schema', filter: { _id: 'shop' } })) as {
      cursor?: { firstBatch?: { version: number }[] };
    };
    const version = result.cursor?.firstBatch?.[0]?.version;
    if (version !== undefined && version !== 2)
      throw new Error('Unknown schema version; apply a reviewed upgrade');
    if (version === undefined) {
      for (const collection of ['Customer', 'Product', 'Order', 'OrderItem', 'User']) {
        const count = await db.$runCommandRaw({ count: collection });
        if (Number(count.n) > 0)
          throw new Error(
            'Existing unversioned data detected. Follow docs/UPGRADING.md; automatic conversion is disabled.',
          );
      }
    }
    const child = spawnSync(
      process.execPath,
      [resolve('node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'],
      { stdio: 'inherit', env: process.env },
    );
    if (child.status !== 0) throw new Error('Schema setup failed');
    await db.$runCommandRaw({
      update: '_schema',
      updates: [{ q: { _id: 'shop' }, u: { $set: { version: 2 } }, upsert: true }],
    });
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Schema setup failed');
  process.exitCode = 1;
});
