/// <reference types="vitest" />

/**
 * @fileoverview Pins the plugin table-naming rule and the quoting that makes it
 * usable.
 *
 * Two things here would fail silently rather than loudly if they regressed, so
 * they are asserted rather than left to review. The prefix must stay identical
 * to the MongoDB one, because the whole point of sharing `pluginPrefix()` is
 * that a plugin has one namespace and not two. And the physical name must
 * arrive backtick-quoted, because a plugin id keeps its hyphens and the
 * installed ClickHouse client interpolates the table name into the statement
 * without quoting it — an unquoted hyphen is a syntax error on every insert.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IClickHouseService } from '@/types';
import { pluginPrefix } from '@/types';
import { PluginClickHouseService } from '../services/plugin-clickhouse.service.js';

/**
 * Build a stub client that records what it was asked to do.
 *
 * The wrapper's job is entirely about what it forwards, so a stub that
 * captures arguments tests it more directly than a live connection would.
 *
 * @returns A stub implementing the client surface, with vitest spies.
 */
const createStubClient = (): IClickHouseService => {
    const stub = {
        query: vi.fn().mockResolvedValue([]),
        insert: vi.fn().mockResolvedValue(undefined),
        exec: vi.fn().mockResolvedValue(undefined),
        ping: vi.fn().mockResolvedValue(true)
    };

    return stub as unknown as IClickHouseService;
};

describe('PluginClickHouseService', () => {
    describe('uses the same namespace as MongoDB', () => {
        it('derives the prefix from the shared rule', () => {
            const service = new PluginClickHouseService(createStubClient(), 'dust-tracker');

            expect(service.prefix()).toBe('plugin_dust-tracker_');
            expect(service.prefix()).toBe(pluginPrefix('dust-tracker'));
        });

        it('keeps the hyphens the MongoDB collections keep', () => {
            const service = new PluginClickHouseService(createStubClient(), 'delegation-pools');

            // plugin_delegation-pools_, not plugin_delegation_pools_. Converting
            // the hyphen would put the delimiter inside the id and let one
            // plugin's prefix open another's.
            expect(service.prefix()).toBe('plugin_delegation-pools_');
        });

        it('leaves an id with no hyphen alone', () => {
            const service = new PluginClickHouseService(createStubClient(), 'themes');

            expect(service.prefix()).toBe('plugin_themes_');
        });
    });

    describe('no prefix opens another plugin prefix', () => {
        it('keeps a shorter id from matching a longer one', () => {
            const shorter = new PluginClickHouseService(createStubClient(), 'dust');
            const longer = new PluginClickHouseService(createStubClient(), 'dust-tracker');

            expect(longer.prefix().startsWith(shorter.prefix())).toBe(false);
        });
    });

    describe('table() returns a name ClickHouse can parse', () => {
        it('quotes the physical name', () => {
            const service = new PluginClickHouseService(createStubClient(), 'dust-tracker');

            expect(service.table('dust')).toBe('`plugin_dust-tracker_dust`');
        });

        it('rejects an empty logical name rather than returning a bare prefix', () => {
            const service = new PluginClickHouseService(createStubClient(), 'dust-tracker');

            expect(() => service.table('')).toThrow();
        });

        it('rejects a name that would break out of the quoting', () => {
            const service = new PluginClickHouseService(createStubClient(), 'dust-tracker');

            // The closing backtick ends the identifier and everything after it
            // would be parsed as SQL. A plugin building a table name from data
            // is how a value like this arrives.
            expect(() => service.table('dust`; DROP TABLE users; --')).toThrow(/injection/);
        });

        it('rejects the characters ClickHouse cannot take unquoted', () => {
            const service = new PluginClickHouseService(createStubClient(), 'dust-tracker');

            // Rejected rather than rewritten to `dust_daily`, so a plugin is
            // told at the call site instead of quietly reading and writing a
            // table it did not name.
            expect(() => service.table('dust-daily')).toThrow();
            expect(() => service.table('dust.daily')).toThrow();
            expect(() => service.table('dust daily')).toThrow();
            expect(() => service.table('1dust')).toThrow();
        });

        it('accepts the names plugins actually use', () => {
            const service = new PluginClickHouseService(createStubClient(), 'dust-tracker');

            expect(service.table('block_totals')).toBe('`plugin_dust-tracker_block_totals`');
            expect(service.table('_staging2')).toBe('`plugin_dust-tracker__staging2`');
        });
    });

    describe('insert scopes the table for the caller', () => {
        it('forwards the quoted physical name', async () => {
            const client = createStubClient();
            const service = new PluginClickHouseService(client, 'dust-tracker');

            await service.insert('dust', [{ txId: 'abc' }]);

            expect(client.insert).toHaveBeenCalledWith(
                '`plugin_dust-tracker_dust`',
                [{ txId: 'abc' }],
                undefined
            );
        });

        it('rejects an unusable table name before reaching the client', async () => {
            const client = createStubClient();
            const service = new PluginClickHouseService(client, 'dust-tracker');

            // insert() names the table through table(), so the guard covers the
            // path that actually reaches SQL and not just the helper.
            await expect(service.insert('dust`; --', [{ txId: 'abc' }])).rejects.toThrow();
            expect(client.insert).not.toHaveBeenCalled();
        });

        it('passes per-call options through', async () => {
            const client = createStubClient();
            const service = new PluginClickHouseService(client, 'dust-tracker');

            await service.insert('dust', [{ txId: 'abc' }], { waitForCommit: true });

            expect(client.insert).toHaveBeenCalledWith(
                '`plugin_dust-tracker_dust`',
                [{ txId: 'abc' }],
                { waitForCommit: true }
            );
        });
    });

    describe('query and exec pass through untouched', () => {
        it('does not rewrite the SQL it is given', async () => {
            const client = createStubClient();
            const service = new PluginClickHouseService(client, 'dust-tracker');
            const sql = 'SELECT * FROM `plugin_dust-tracker_dust`';

            await service.query(sql, { limit: 10 });

            expect(client.query).toHaveBeenCalledWith(sql, { limit: 10 });
        });

        it('forwards DDL unchanged', async () => {
            const client = createStubClient();
            const service = new PluginClickHouseService(client, 'dust-tracker');

            await service.exec('DROP TABLE IF EXISTS `plugin_dust-tracker_dust`');

            expect(client.exec).toHaveBeenCalledWith(
                'DROP TABLE IF EXISTS `plugin_dust-tracker_dust`'
            );
        });
    });

    describe('rejects an unusable plugin id', () => {
        it('throws rather than building a prefix matching every table', () => {
            expect(() => new PluginClickHouseService(createStubClient(), '')).toThrow();
        });
    });
});
