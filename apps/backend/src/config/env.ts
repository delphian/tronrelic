import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // NODE_ENV is automatically set by Node.js/Next.js tooling (don't set in .env)
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  // ENV is the deployment environment (set in .env: development, staging, production)
  ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  REDIS_NAMESPACE: z.string().default('tronrelic'),
  TRONGRID_API_KEY: z.string().optional(),
  TRONGRID_API_KEY_2: z.string().optional(),
  TRONGRID_API_KEY_3: z.string().optional(),
  TELEGRAM_IP_ALLOWLIST: z.string().optional(),
  ALERT_WHALE_MIN_TRX: z.union([z.string(), z.coerce.number()]).optional(),
  ADMIN_API_TOKEN: z.string().optional(),
  METRICS_TOKEN: z.string().optional(),
  ENABLE_TELEMETRY: z
    .union([
      z.boolean(),
      z
        .string()
        .transform(value => value.trim().toLowerCase())
        .transform(value => ['1', 'true', 'yes', 'on'].includes(value))
    ])
    .default(true),
  ENABLE_SCHEDULER: z
    .union([
      z.boolean(),
      z
        .string()
        .transform(value => value.trim().toLowerCase())
        .transform(value => ['1', 'true', 'yes', 'on'].includes(value))
    ])
    .default(true),
  ENABLE_WEBSOCKETS: z
    .union([
      z.boolean(),
      z
        .string()
        .transform(value => value.trim().toLowerCase())
        .transform(value => ['1', 'true', 'yes', 'on'].includes(value))
    ])
    .default(true),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().optional(),
  NOTIFICATION_WEBSOCKET_THROTTLE_MS: z.coerce.number().int().positive().default(5000),
  NOTIFICATION_EMAIL_THROTTLE_MS: z.coerce.number().int().positive().default(300000)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Failed to parse environment variables');
}

export type EnvConfig = z.infer<typeof envSchema>;

export const env: EnvConfig = parsed.data;
