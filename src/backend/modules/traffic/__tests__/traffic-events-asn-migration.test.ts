/// <reference types="vitest" />

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService, IDatabaseService, IMigrationContext } from '@/types';
import { migration } from '../migrations/019_traffic_events_asn_column.js';

/**
 * Shape and behaviour test for the ASN column migration.
 *
 * Mirrors the 012 test: there is no embedded ClickHouse in CI, so the goals
 * are catching id/filename drift, skipping cleanly without ClickHouse,
 * targeting ClickHouse, and issuing an idempotent ALTER placed after the
 * column it depends on.
 */
describe('migration: 019_traffic_events_asn_column', () => {
    it('declares a ClickHouse target', () => {
        expect(migration.target).toBe('clickhouse');
    });

    it('uses the canonical id matching the filename', () => {
        expect(migration.id).toBe('019_traffic_events_asn_column');
    });

    it('depends on the table and on the channel column it is placed after', () => {
        expect(migration.dependencies).toContain('module:traffic:010_create_traffic_events_table');
        expect(migration.dependencies).toContain('module:traffic:016_traffic_events_channel_column');
    });

    it('does nothing when ClickHouse is unavailable', async () => {
        const context: IMigrationContext = {
            database: {} as IDatabaseService,
            clickhouse: undefined
        };
        await expect(migration.up(context)).resolves.toBeUndefined();
    });

    it('issues an idempotent ALTER adding a nullable 32-bit asn column', async () => {
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
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS asn Nullable(UInt32) AFTER channel');
    });
});
