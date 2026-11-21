/**
 * @fileoverview Pins what a chain data retention migration sends to ClickHouse.
 *
 * Every retention migration goes through `applyChainDataRetention()`. A table it
 * skipped would keep dropping days at the old retention without any error, and
 * a statement sent to a table the writer has not created yet would fail the
 * migration on a fresh deployment, so both paths are checked here.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService } from '@/types';
import { applyChainDataRetention } from '../chain-data/applyChainDataRetention.js';
import { chainDataExpiringTables } from '../chain-data/buildChainDataSchema.js';

/**
 * A ClickHouse stand-in whose `system.tables` lists the given tables and which
 * records every statement it is asked to run.
 */
function fakeClickHouse(existingTables: string[]): { clickhouse: IClickHouseService; exec: ReturnType<typeof vi.fn> } {
    const exec = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue(existingTables.map(name => ({ name })));
    return { clickhouse: { query, exec } as unknown as IClickHouseService, exec };
}

describe('applyChainDataRetention', () => {
    it('moves every expiring table that exists to the given retention', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const tables = chainDataExpiringTables();
        const { clickhouse, exec } = fakeClickHouse(tables.map(entry => entry.table));

        await applyChainDataRetention(clickhouse, 21, '[test]');

        const statements = exec.mock.calls.map(call => call[0] as string);
        expect(statements).toHaveLength(tables.length * 2);
        for (const entry of tables) {
            expect(statements).toContain(`ALTER TABLE tron.${entry.table} MODIFY TTL toDateTime(${entry.timeColumn}) + INTERVAL 21 DAY DELETE`);
        }
    });

    it('skips a table the writer has not created yet', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const { clickhouse, exec } = fakeClickHouse(['block']);

        await applyChainDataRetention(clickhouse, 21, '[test]');

        expect(exec.mock.calls.map(call => call[0])).toEqual([
            'ALTER TABLE tron.block MODIFY SETTING materialize_ttl_recalculate_only = 1',
            'ALTER TABLE tron.block MODIFY TTL toDateTime(timestamp) + INTERVAL 21 DAY DELETE'
        ]);
    });
});
