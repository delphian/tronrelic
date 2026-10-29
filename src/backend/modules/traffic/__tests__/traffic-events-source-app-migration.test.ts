/// <reference types="vitest" />

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService, IDatabaseService, IMigrationContext } from '@/types';
import { migration } from '../migrations/020_traffic_events_source_app_column.js';

/**
 * Shape and behaviour test for the source-app column migration.
 *
 * Mirrors the 019 test: there is no embedded ClickHouse in CI, so the goals
 * are catching id/filename drift, skipping cleanly without ClickHouse,
 * targeting ClickHouse, and issuing an idempotent ALTER placed after the
 * column it depends on.
 */
describe('migration: 020_traffic_events_source_app_column', () => {
    it('declares a ClickHouse target', () => {
        expect(migration.target).toBe('clickhouse');
    });

    it('uses the canonical id matching the filename', () => {
        expect(migration.id).toBe('020_traffic_events_source_app_column');
    });

    it('depends on the table and on the asn column it is placed after', () => {
        expect(migration.dependencies).toContain('module:traffic:010_create_traffic_events_table');
        expect(migration.dependencies).toContain('module:traffic:019_traffic_events_asn_column');
    });

    it('does nothing when ClickHouse is unavailable', async () => {
        const context: IMigrationContext = {
            database: {} as IDatabaseService,
            clickhouse: undefined
        };
        await expect(migration.up(context)).resolves.toBeUndefined();
    });

    it('issues an idempotent ALTER adding a low-cardinality nullable source_app column', async () => {
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
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS source_app LowCardinality(Nullable(String)) AFTER asn');
    });
});
