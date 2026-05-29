/// <reference types="vitest" />

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService, IDatabaseService, IMigrationContext } from '@/types';
import { migration } from '../migrations/010_create_traffic_events_table.js';

/**
 * Shape and behaviour test for the Phase 0 traffic_events migration.
 *
 * Lightweight on purpose: the migration is one CREATE TABLE statement
 * against ClickHouse, and we have no embedded ClickHouse in CI. The
 * goals are (a) catch filename/id drift (the scanner enforces this in
 * production but we want the failure earlier), (b) confirm the runner's
 * skip-when-CH-absent behaviour, and (c) confirm the migration targets
 * ClickHouse so the executor routes it correctly.
 */
describe('migration: 010_create_traffic_events_table', () => {
    it('declares a ClickHouse target so the executor skips when CH is unconfigured', () => {
        expect(migration.target).toBe('clickhouse');
    });

    it('uses the canonical id matching the filename', () => {
        // Scanner validates this in production; surface it earlier in CI too.
        expect(migration.id).toBe('010_create_traffic_events_table');
    });

    it('does nothing when ClickHouse is unavailable', async () => {
        const context: IMigrationContext = {
            database: {} as IDatabaseService,
            clickhouse: undefined
        };
        await expect(migration.up(context)).resolves.toBeUndefined();
    });

    it('issues a CREATE TABLE for traffic_events with an 18-month TTL', async () => {
        const exec = vi.fn<(sql: string) => Promise<void>>(async () => undefined);
        const clickhouse = { exec } as unknown as IClickHouseService;
        const context: IMigrationContext = {
            database: {} as IDatabaseService,
            clickhouse
        };

        await migration.up(context);

        expect(exec).toHaveBeenCalledTimes(1);
        const sql = exec.mock.calls[0][0];
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS traffic_events');
        expect(sql).toContain('ORDER BY (timestamp, candidate_uid)');
        expect(sql).toContain('INTERVAL 18 MONTH');
        expect(sql).toContain('idx_candidate_uid');
    });
});
