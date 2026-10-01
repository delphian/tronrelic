/**
 * @fileoverview The list of this deployment's own secret values.
 *
 * Some output leaves the platform for a place it does not control, such as an
 * MCP user's AI client. A component that wants to make sure none of the
 * deployment's credentials go with it needs to know what they are, and the
 * backend holds every one of them in its environment. Keeping the list here,
 * beside `env.ts`, means a new secret variable is added in one place rather
 * than in each component that scrubs output.
 */

import type { EnvConfig } from './env.js';

/**
 * Names of the environment variables whose values are secrets. Connection
 * URLs are included because they usually carry a password.
 */
const SECRET_ENV_KEYS: ReadonlyArray<keyof EnvConfig> = [
    'MONGODB_URI',
    'REDIS_URL',
    'TRONGRID_API_KEY',
    'TRONGRID_API_KEY_2',
    'TRONGRID_API_KEY_3',
    'ADMIN_API_TOKEN',
    'METRICS_TOKEN',
    'SESSION_SECRET',
    'TRAFFIC_IP_HASH_SALT',
    'BETTER_AUTH_SECRET',
    'RESEND_API_KEY',
    'GOOGLE_CLIENT_SECRET',
    'GITHUB_CLIENT_SECRET',
    'STORAGE_SECRET_ACCESS_KEY'
];

/**
 * Collect the values of every secret this deployment is configured with.
 *
 * `CLICKHOUSE_PASSWORD` is read from the raw environment because the
 * ClickHouse module reads it there rather than through the validated schema.
 *
 * @param config - The validated environment, normally `env`.
 * @param rawEnv - The raw process environment, for variables outside the schema.
 * @returns Every non-empty secret value, in no particular order.
 */
export function collectDeploymentSecrets(config: EnvConfig, rawEnv: NodeJS.ProcessEnv): string[] {
    const values: unknown[] = SECRET_ENV_KEYS.map(key => config[key]);
    values.push(rawEnv.CLICKHOUSE_PASSWORD);
    return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
