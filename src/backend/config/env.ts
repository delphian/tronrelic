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
  // Site URL for CORS configuration and runtime config
  SITE_URL: z.string().optional(),
  TRONGRID_API_KEY: z.string().optional(),
  TRONGRID_API_KEY_2: z.string().optional(),
  TRONGRID_API_KEY_3: z.string().optional(),
  TELEGRAM_IP_ALLOWLIST: z.string().optional(),
  ALERT_WHALE_MIN_TRX: z.union([z.string(), z.coerce.number()]).optional(),
  ADMIN_API_TOKEN: z.string().optional(),
  METRICS_TOKEN: z.string().optional(),
  /**
   * HMAC secret used to sign the `tronrelic_uid` identity cookie.
   *
   * Required in production: cookie-parser falls back to no-op signing if a
   * secret is not provided, which silently disables forgery protection.
   * In dev/test we accept the absence with a console.warn and a stable
   * placeholder so contributors don't have to configure one locally — the
   * placeholder must not be used in any non-development deployment.
   */
  SESSION_SECRET: z.string().optional(),
  /**
   * Better Auth HMAC secret used to sign session tokens and the session cookie.
   * Required in production for the same reason as SESSION_SECRET — the absence
   * of a secret would let any caller mint a forged session token.
   * Generate with `openssl rand -hex 32`.
   */
  BETTER_AUTH_SECRET: z.string().optional(),
  /**
   * Canonical base URL Better Auth uses to construct OAuth redirect URIs.
   * Optional — falls back to SITE_URL when unset.
   */
  BETTER_AUTH_URL: z.string().optional(),
  /**
   * Comma-separated list of email addresses auto-promoted to the `admin`
   * group when they complete signup. Empty/unset means no auto-promotion;
   * the operator bootstraps the first admin via the service-token path.
   */
  ADMIN_EMAILS: z.string().optional(),
  /**
   * Resend API key used to send sign-in code (OTP) emails. When unset, the
   * email-OTP plugin logs codes to the console for development. Set in any
   * environment where real users sign in.
   */
  RESEND_API_KEY: z.string().optional(),
  /**
   * Verified `From` address Resend uses for outbound mail. Must be on a
   * domain whose DKIM/SPF records are configured in Resend.
   */
  RESEND_FROM_ADDRESS: z.string().optional(),
  /**
   * Google OAuth client ID and secret. Both must be set for the Google
   * social provider to load; otherwise it is omitted from Better Auth's
   * provider list.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /**
   * GitHub OAuth client ID and secret. Both must be set for the GitHub
   * social provider to load; otherwise it is omitted.
   */
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
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

// Enforce SESSION_SECRET in any non-development environment. Development and
// test fall through to a hardcoded placeholder that is only safe locally; the
// resolved value lives on `env.SESSION_SECRET` after this block runs.
const DEV_SESSION_SECRET_FALLBACK = 'tronrelic-dev-cookie-secret-do-not-use-in-prod';
if (!parsed.data.SESSION_SECRET) {
  if (parsed.data.NODE_ENV === 'production' || parsed.data.ENV === 'production') {
    throw new Error(
      'SESSION_SECRET is required in production. Generate one with `openssl rand -hex 32` and set it in your environment.'
    );
  }
  console.warn(
    '[env] SESSION_SECRET unset — using a fixed development placeholder. Identity cookies will be signed with a known secret. Set SESSION_SECRET before deploying anywhere non-local.'
  );
  parsed.data.SESSION_SECRET = DEV_SESSION_SECRET_FALLBACK;
}

// Mirror the SESSION_SECRET policy for BETTER_AUTH_SECRET. A missing secret
// in dev/test is acceptable with a warning and a fixed placeholder so local
// signup flows work without per-developer config; production must supply a
// real secret or boot fails.
const DEV_BETTER_AUTH_SECRET_FALLBACK = 'tronrelic-dev-better-auth-secret-do-not-use-in-prod';
if (!parsed.data.BETTER_AUTH_SECRET) {
  if (parsed.data.NODE_ENV === 'production' || parsed.data.ENV === 'production') {
    throw new Error(
      'BETTER_AUTH_SECRET is required in production. Generate one with `openssl rand -hex 32` and set it in your environment.'
    );
  }
  console.warn(
    '[env] BETTER_AUTH_SECRET unset — using a fixed development placeholder. Better Auth session tokens will be signed with a known secret. Set BETTER_AUTH_SECRET before deploying anywhere non-local.'
  );
  parsed.data.BETTER_AUTH_SECRET = DEV_BETTER_AUTH_SECRET_FALLBACK;
}

export type EnvConfig = z.infer<typeof envSchema>;

export const env: EnvConfig = parsed.data;
