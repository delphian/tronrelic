/**
 * @fileoverview Pins how the chain data tables expire and how a retention change reaches them.
 *
 * A retention change on a deployment that already has the tables goes through
 * `chainDataExpiringTables()` and `buildChainDataRetentionStatements()`, not
 * through the `CREATE TABLE` statements. These tests keep the two in step: a
 * data table missing from the list would silently keep its old retention, and a
 * `MODIFY TTL` sent without the recalculate-only setting would rewrite the whole
 * table on production.
 */

import { describe, it, expect } from 'vitest';
import {
    buildChainDataRetentionStatements,
    buildChainDataSchema,
    chainDataExpiringTables
} from '../chain-data/buildChainDataSchema.js';

/**
 * Pull the table name out of a `CREATE TABLE IF NOT EXISTS tron.<name>` statement.
 *
 * @param statement - One statement from `buildChainDataSchema()`.
 * @returns The table name, or null when the statement creates no table.
 */
function createdTableName(statement: string): string | null {
    const match = /^CREATE TABLE IF NOT EXISTS tron\.(\w+)/.exec(statement);
    return match ? match[1] : null;
}

describe('chain data retention', () => {
    it('lists exactly the tables whose definition expires on the retention', () => {
        const retentionDays = 11;
        const expiring = buildChainDataSchema(retentionDays)
            .filter(statement => statement.includes(`INTERVAL ${retentionDays} DAY DELETE`))
            .map(createdTableName);

        expect(chainDataExpiringTables().map(entry => entry.table)).toEqual(expiring);
    });

    it('names the same expiry column the table definition uses', () => {
        const statements = buildChainDataSchema(11);
        for (const entry of chainDataExpiringTables()) {
            const statement = statements.find(candidate => createdTableName(candidate) === entry.table);
            expect(statement, entry.table).toContain(`TTL toDateTime(${entry.timeColumn}) + INTERVAL 11 DAY DELETE`);
        }
    });

    it('creates every expiring table with the recalculate-only setting', () => {
        const statements = buildChainDataSchema(11);
        for (const entry of chainDataExpiringTables()) {
            const statement = statements.find(candidate => createdTableName(candidate) === entry.table);
            expect(statement, entry.table).toContain('materialize_ttl_recalculate_only = 1');
        }
    });

    it('sets recalculate-only before it changes the TTL', () => {
        const statements = buildChainDataRetentionStatements({ table: 'block', timeColumn: 'timestamp' }, 14);

        expect(statements).toEqual([
            'ALTER TABLE tron.block MODIFY SETTING materialize_ttl_recalculate_only = 1',
            'ALTER TABLE tron.block MODIFY TTL toDateTime(timestamp) + INTERVAL 14 DAY DELETE'
        ]);
    });
});
