/// <reference types="vitest" />

/**
 * @fileoverview Shape test for the migration creating `traffic_goal_events`.
 *
 * There is no embedded ClickHouse in CI, so, like the other ClickHouse
 * migration tests, this guards id and filename drift, the clean skip without
 * ClickHouse, and the parts of the DDL the reads depend on: the sort key the
 * ignore list prunes on, the non-nullable tid the "no tid" sentinel needs, and
 * the columns attribution and the bot filter read.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService, IDatabaseService, IMigrationContext } from '@/types';
import { migration } from '../migrations/024_create_traffic_goal_events_table.js';

describe('migration: 024_create_traffic_goal_events_table', () => {
    it('targets ClickHouse under the id matching its filename', () => {
        expect(migration.target).toBe('clickhouse');
        expect(migration.id).toBe('024_create_traffic_goal_events_table');
    });

    it('does nothing when ClickHouse is unavailable', async () => {
        const context: IMigrationContext = { database: {} as IDatabaseService, clickhouse: undefined };
        await expect(migration.up(context)).resolves.toBeUndefined();
    });

    it('creates the table idempotently with the columns the goal reads need', async () => {
        const exec = vi.fn<(sql: string) => Promise<void>>(async () => undefined);
        const context: IMigrationContext = {
            database: {} as IDatabaseService,
            clickhouse: { exec } as unknown as IClickHouseService
        };

        await migration.up(context);

        expect(exec).toHaveBeenCalledTimes(1);
        const sql = exec.mock.calls[0]![0];
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS traffic_goal_events');
        // Same key as traffic_events, so the ignore list's literal NOT IN prunes.
        expect(sql).toContain('ORDER BY (timestamp, candidate_uid)');
        // Not Nullable: anonymous goals use the all-zero UUID instead.
        expect(sql).toMatch(/candidate_uid UUID,/);
        expect(sql).toContain('properties Map(LowCardinality(String), String)');
        for (const column of ['goal', 'user_id', 'path', 'analytics_consent', 'bot_class', 'country', 'device', 'asn', 'ip_hash', 'subnet_hash']) {
            expect(sql).toMatch(new RegExp(`\\b${column} `));
        }
        expect(sql).toContain('INTERVAL 18 MONTH DELETE');
    });
});
