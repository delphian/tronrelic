/// <reference types="vitest" />

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService, IDatabaseService, IMigrationContext } from '@/types';
import { migration } from '../migrations/012_traffic_events_user_referral_columns.js';

/**
 * Shape and behaviour test for the Phase 5 additive-columns migration.
 *
 * Mirrors the 010 test: no embedded ClickHouse in CI, so the goals are
 * id/filename-drift detection, skip-when-CH-absent, ClickHouse targeting,
 * and that the ALTER adds both columns idempotently outside the sort key.
 */
describe('migration: 012_traffic_events_user_referral_columns', () => {
    it('declares a ClickHouse target', () => {
        expect(migration.target).toBe('clickhouse');
    });

    it('uses the canonical id matching the filename', () => {
        expect(migration.id).toBe('012_traffic_events_user_referral_columns');
    });

    it('depends on the table-creation migration', () => {
        expect(migration.dependencies).toContain('module:user:010_create_traffic_events_table');
    });

    it('does nothing when ClickHouse is unavailable', async () => {
        const context: IMigrationContext = {
            database: {} as IDatabaseService,
            clickhouse: undefined
        };
        await expect(migration.up(context)).resolves.toBeUndefined();
    });

    it('issues an idempotent ALTER adding user_id and referral_code', async () => {
        const exec = vi.fn<(sql: string) => Promise<void>>(async () => undefined);
        const clickhouse = { exec } as unknown as IClickHouseService;
        const context: IMigrationContext = {
            database: {} as IDatabaseService,
            clickhouse
        };

        await migration.up(context);

        expect(exec).toHaveBeenCalledTimes(1);
        const sql = exec.mock.calls[0][0];
        expect(sql).toContain('ALTER TABLE traffic_events');
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS user_id Nullable(String)');
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS referral_code');
    });
});
