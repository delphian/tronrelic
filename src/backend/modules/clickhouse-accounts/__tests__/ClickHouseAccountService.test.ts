/// <reference types="vitest" />

/**
 * @fileoverview Behaviour of the ClickHouse accounts service against a stub
 * ClickHouse and the in-memory database mock.
 *
 * The rules pinned here are the ones an admin relies on without seeing them:
 * a limit is stored only after ClickHouse accepts it, every action is audited
 * whether or not it succeeds, an account that failed to apply hands out no
 * connection, and the chain writer's account can never be limited or have its
 * queries stopped from the admin page.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IClickHouseAccountConnector, IClickHouseReader, IClickHouseService, ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AI_AGENT_ACCOUNT_ID, DEFAULT_ACCOUNT_ID, buildAccountDefinitions } from '../services/buildAccountDefinitions.js';
import { ClickHouseAccountError } from '../services/ClickHouseAccountError.js';
import { ClickHouseAccountInspector } from '../services/ClickHouseAccountInspector.js';
import { ClickHouseAccountService } from '../services/ClickHouseAccountService.js';
import { AUDIT_COLLECTION, ClickHouseAccountStore, LIMITS_COLLECTION } from '../services/ClickHouseAccountStore.js';
import { ClickHouseAccountUsageRollup } from '../services/ClickHouseAccountUsageRollup.js';

/**
 * Build a logger whose methods are spies, so tests can run without output and
 * assert on warnings.
 *
 * @returns A stub logger.
 */
function createLogger(): ISystemLogService {
    const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
    stub.child.mockReturnValue(stub);

    return stub as unknown as ISystemLogService;
}

/**
 * Wire a fresh service with a stub ClickHouse whose `exec` can be made to fail.
 *
 * @returns The service plus the stubs and database the tests inspect.
 */
function setup() {
    ClickHouseAccountService.resetForTests();
    const clickhouse = {
        query: vi.fn().mockResolvedValue([]),
        insert: vi.fn().mockResolvedValue(undefined),
        exec: vi.fn().mockResolvedValue(undefined),
        ping: vi.fn().mockResolvedValue(true)
    };
    const reader: IClickHouseReader = { accountId: AI_AGENT_ACCOUNT_ID, query: vi.fn() };
    const connector = {
        rootUser: vi.fn().mockReturnValue('default'),
        hasRootPassword: vi.fn().mockReturnValue(true),
        accountPasswordHash: vi.fn().mockReturnValue('b'.repeat(64)),
        openReader: vi.fn().mockReturnValue(reader)
    };
    const database = createMockDatabaseService();
    const store = new ClickHouseAccountStore(database);
    const logger = createLogger();
    ClickHouseAccountService.setDependencies({
        definitions: buildAccountDefinitions('default'),
        connector: connector as unknown as IClickHouseAccountConnector,
        clickhouse: clickhouse as unknown as IClickHouseService,
        store,
        inspector: new ClickHouseAccountInspector(clickhouse as unknown as IClickHouseService),
        rollup: new ClickHouseAccountUsageRollup(clickhouse as unknown as IClickHouseService),
        logger
    });

    return { service: ClickHouseAccountService.getInstance(), clickhouse, connector, database, reader, logger };
}

describe('ClickHouseAccountService', () => {
    let ctx: ReturnType<typeof setup>;

    beforeEach(() => {
        ctx = setup();
    });

    it('starts managed accounts pending and observed accounts observed', async () => {
        const accounts = await ctx.service.listAccounts();
        expect(accounts.find(account => account.id === AI_AGENT_ACCOUNT_ID)?.state).toBe('pending');
        expect(accounts.find(account => account.id === DEFAULT_ACCOUNT_ID)?.state).toBe('observed');
    });

    it('applyAll marks a cleanly applied account active and hands out one shared reader', async () => {
        await ctx.service.applyAll();
        const account = await ctx.service.getAccount(AI_AGENT_ACCOUNT_ID);
        expect(account?.state).toBe('active');
        expect(ctx.service.reader(AI_AGENT_ACCOUNT_ID)).toBe(ctx.reader);
        expect(ctx.service.reader(AI_AGENT_ACCOUNT_ID)).toBe(ctx.reader);
        expect(ctx.connector.openReader).toHaveBeenCalledTimes(1);
        expect(ctx.connector.openReader).toHaveBeenCalledWith(AI_AGENT_ACCOUNT_ID, 'tronrelic_ai_agent', 'tron', 2);
    });

    it('applyAll marks a failed account error and refuses its reader', async () => {
        ctx.clickhouse.exec.mockRejectedValueOnce(new Error('Not enough privileges'));
        await ctx.service.applyAll();
        const account = await ctx.service.getAccount(AI_AGENT_ACCOUNT_ID);
        expect(account?.state).toBe('error');
        expect(account?.error).toContain('Not enough privileges');
        expect(() => ctx.service.reader(AI_AGENT_ACCOUNT_ID)).toThrow(ClickHouseAccountError);
    });

    it('applyAll warns when the root password is empty', async () => {
        ctx.connector.hasRootPassword.mockReturnValue(false);
        await ctx.service.applyAll();
        expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('CLICKHOUSE_PASSWORD'));
    });

    it('applyAll applies stored limits, lowered to any ceiling below them', async () => {
        const policy = buildAccountDefinitions('default').find(definition => definition.id === AI_AGENT_ACCOUNT_ID)!.policy!;
        ctx.database.getCollectionData(LIMITS_COLLECTION).push({
            accountId: AI_AGENT_ACCOUNT_ID,
            limits: { ...policy.defaultLimits, maxThreads: 4, maxResultRows: policy.ceilings.maxResultRows + 1 },
            updatedAt: new Date(),
            updatedBy: 'admin-1'
        });
        await ctx.service.applyAll();
        const account = await ctx.service.getAccount(AI_AGENT_ACCOUNT_ID);
        expect(account?.limits?.maxThreads).toBe(4);
        expect(account?.limits?.maxResultRows).toBe(policy.ceilings.maxResultRows);
    });

    it('updateLimits stores and audits the change after ClickHouse accepts it', async () => {
        await ctx.service.applyAll();
        const account = await ctx.service.updateLimits(AI_AGENT_ACCOUNT_ID, { maxThreads: 4 }, 'admin-1', 'more headroom');
        expect(account.limits?.maxThreads).toBe(4);
        expect(ctx.database.getCollectionData(LIMITS_COLLECTION)[0]).toMatchObject({ accountId: AI_AGENT_ACCOUNT_ID, updatedBy: 'admin-1' });
        const [entry] = ctx.database.getCollectionData(AUDIT_COLLECTION);
        expect(entry).toMatchObject({ action: 'update-limits', actorId: 'admin-1', reason: 'more headroom', succeeded: true });
        expect(entry.before.maxThreads).toBe(2);
        expect(entry.after.maxThreads).toBe(4);
    });

    it('updateLimits on a refused change audits the failure, stores nothing, and answers 502', async () => {
        await ctx.service.applyAll();
        ctx.clickhouse.exec.mockRejectedValueOnce(new Error('boom'));
        await expect(ctx.service.updateLimits(AI_AGENT_ACCOUNT_ID, { maxThreads: 4 }, 'admin-1', null))
            .rejects.toMatchObject({ status: 502 });
        expect(ctx.database.getCollectionData(LIMITS_COLLECTION)).toHaveLength(0);
        expect(ctx.database.getCollectionData(AUDIT_COLLECTION)[0]).toMatchObject({ succeeded: false, detail: 'boom' });
        expect((await ctx.service.getAccount(AI_AGENT_ACCOUNT_ID))?.limits?.maxThreads).toBe(2);
    });

    it('refuses to limit or stop queries on the observed default account', async () => {
        await expect(ctx.service.updateLimits(DEFAULT_ACCOUNT_ID, { maxThreads: 4 }, 'admin-1', null))
            .rejects.toMatchObject({ status: 409 });
        await expect(ctx.service.killQuery(DEFAULT_ACCOUNT_ID, 'abc', 'admin-1')).rejects.toMatchObject({ status: 409 });
        expect(() => ctx.service.reader(DEFAULT_ACCOUNT_ID)).toThrow(ClickHouseAccountError);
    });

    it('killQuery stops only a query running under the account, and audits the attempt', async () => {
        await ctx.service.applyAll();
        ctx.clickhouse.query.mockResolvedValueOnce([{ n: '1' }]);
        expect(await ctx.service.killQuery(AI_AGENT_ACCOUNT_ID, 'q-1', 'admin-1')).toBe(true);
        expect(ctx.clickhouse.exec).toHaveBeenLastCalledWith(
            "KILL QUERY WHERE query_id = 'q-1' AND user = 'tronrelic_ai_agent' ASYNC"
        );
        expect(ctx.database.getCollectionData(AUDIT_COLLECTION)[0]).toMatchObject({ action: 'kill-query', succeeded: true });
    });

    it('killQuery refuses an unsafe query id with a 400 and audits it', async () => {
        await expect(ctx.service.killQuery(AI_AGENT_ACCOUNT_ID, "x' OR '1", 'admin-1')).rejects.toMatchObject({ status: 400 });
        expect(ctx.database.getCollectionData(AUDIT_COLLECTION)[0]).toMatchObject({ action: 'kill-query', succeeded: false });
    });

    it('answers 404 for an unknown account', async () => {
        await expect(ctx.service.listAudit('nope', 10)).rejects.toMatchObject({ status: 404 });
        expect(await ctx.service.getAccount('nope')).toBeNull();
    });
});
