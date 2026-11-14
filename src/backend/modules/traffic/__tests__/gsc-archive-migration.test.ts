/// <reference types="vitest" />

/**
 * Shape test for migration 023, which creates the permanent Search Console
 * archive tables.
 *
 * There is no embedded ClickHouse in CI, so this checks the statements the
 * migration sends: the id matches the filename, nothing runs without
 * ClickHouse, each table replaces a refetched row on the right key, and no
 * table carries a TTL, because the archive exists to keep history forever.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService, IDatabaseService, IMigrationContext } from '@/types';
import { migration } from '../migrations/023_create_gsc_archive_tables.js';

/**
 * Run the migration against a ClickHouse double and collect what it sent.
 *
 * @returns Every SQL statement passed to `exec`, in order.
 */
async function runAndCollectSql(): Promise<string[]> {
    const exec = vi.fn<(sql: string) => Promise<void>>(async () => undefined);
    const context: IMigrationContext = {
        database: {} as IDatabaseService,
        clickhouse: { exec } as unknown as IClickHouseService
    };
    await migration.up(context);
    return exec.mock.calls.map(([sql]) => sql);
}

describe('migration: 023_create_gsc_archive_tables', () => {
    it('targets ClickHouse and uses the id matching the filename', () => {
        expect(migration.target).toBe('clickhouse');
        expect(migration.id).toBe('023_create_gsc_archive_tables');
    });

    it('does nothing when ClickHouse is unavailable', async () => {
        const context: IMigrationContext = { database: {} as IDatabaseService, clickhouse: undefined };
        await expect(migration.up(context)).resolves.toBeUndefined();
    });

    it('creates the three archive tables keyed on the dimensions Google reports', async () => {
        const sql = await runAndCollectSql();

        expect(sql).toHaveLength(3);
        expect(sql[0]).toContain('CREATE TABLE IF NOT EXISTS gsc_queries');
        expect(sql[0]).toContain('ORDER BY (query, date, page, country, device)');
        expect(sql[1]).toContain('CREATE TABLE IF NOT EXISTS gsc_daily_totals');
        expect(sql[1]).toContain('ORDER BY date');
        expect(sql[2]).toContain('CREATE TABLE IF NOT EXISTS gsc_page_totals');
        expect(sql[2]).toContain('ORDER BY (page, date)');
        for (const statement of sql) {
            expect(statement).toContain('ReplacingMergeTree(fetched_at)');
        }
    });

    it('gives no table a TTL', async () => {
        const sql = await runAndCollectSql();

        for (const statement of sql) {
            expect(statement).not.toMatch(/\bTTL\b/);
        }
    });
});
