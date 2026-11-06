import { z } from 'zod';
const key = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URL: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  API_READ_KEY: key,
  API_WRITE_KEY: key,
  API_ADMIN_KEY: key,
  CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
  CORS_ORIGINS: z.string().default(''),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(120),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  if (
    new Set([result.data.API_READ_KEY, result.data.API_WRITE_KEY, result.data.API_ADMIN_KEY])
      .size !== 3
  )
    throw new Error('API credentials must be distinct');
  for (const origin of result.data.CORS_ORIGINS.split(',').filter(Boolean)) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error('CORS_ORIGINS must contain exact HTTP origins');
  }
  return result.data;
}
