import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { logger } from '../lib/logger.js';

export type ProviderSecretOverrides = Partial<Record<string, unknown>>;

interface SecretsPayload {
  providers?: Record<string, ProviderSecretOverrides>;
  [key: string]: unknown;
}

function normaliseKey(key: string) {
  return key.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
}

export class MarketSecretManager {
  private readonly providerOverrides = new Map<string, ProviderSecretOverrides>();

  constructor() {
    this.bootstrap();
  }

  getProviderOverrides(key: string): ProviderSecretOverrides | undefined {
    return this.providerOverrides.get(normaliseKey(key));
  }

  private bootstrap() {
    const rawJson = process.env.MARKET_PROVIDER_SECRETS_JSON;
    if (rawJson) {
      this.loadFromJson(rawJson, 'MARKET_PROVIDER_SECRETS_JSON');
    }

    const path = process.env.MARKET_PROVIDER_SECRETS_PATH;
    if (path) {
      this.loadFromFile(path);
    }
  }

  private loadFromJson(payload: string, source: string) {
    try {
      const parsed = JSON.parse(payload) as SecretsPayload;
      this.mergePayload(parsed, source);
    } catch (error) {
      logger.warn({ error, source }, 'Failed to parse market provider secrets JSON');
    }
  }

  private loadFromFile(inputPath: string) {
    const fullPath = isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);
    if (!existsSync(fullPath)) {
      logger.warn({ path: fullPath }, 'Market provider secrets file not found');
      return;
    }

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(content) as SecretsPayload;
      this.mergePayload(parsed, fullPath);
    } catch (error) {
      logger.error({ error, path: fullPath }, 'Failed to load market provider secrets file');
    }
  }

  private mergePayload(payload: SecretsPayload, source: string) {
    const providers = payload.providers && typeof payload.providers === 'object'
      ? payload.providers
      : payload;

    if (!providers || typeof providers !== 'object') {
      logger.warn({ source }, 'Market provider secrets payload missing providers key');
      return;
    }

    for (const [key, value] of Object.entries(providers)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      this.providerOverrides.set(normaliseKey(key), value as ProviderSecretOverrides);
    }
  }
}

export const marketSecretsManager = new MarketSecretManager();
