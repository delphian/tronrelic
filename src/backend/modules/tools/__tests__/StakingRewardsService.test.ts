/**
 * @fileoverview Tests for the staking rewards service's refresh and read paths.
 *
 * A refresh spends about 130 requests on the TronGrid queue block sync shares,
 * so the service must ask for commissions only for representatives that earn
 * rewards, share one refresh between concurrent callers, and leave the stored
 * snapshot untouched when the chain cannot give it a reward rate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IChainParametersService, IDatabaseService, ISystemLogService } from '@/types';
import { StakingRewardsService } from '../services/StakingRewardsService.js';
import type { IStakingRewardsSource } from '../services/IStakingRewardsSource.js';
import type { AddressService } from '../services/address.service.js';

/**
 * A chain parameters service stub whose snapshot carries the given reward
 * rates; leave one out to test a snapshot that predates the field.
 *
 * @param rates - The reward rates the snapshot holds.
 * @returns The stub.
 */
function createChainParameters(rates: { blockRewardSun?: number; voteRewardSun?: number }): IChainParametersService {
    return {
        getParameters: vi.fn(async () => ({ network: 'mainnet', parameters: rates, fetchedAt: new Date(), createdAt: new Date() }))
    } as unknown as IChainParametersService;
}

/**
 * A database stub holding one collection in memory, enough for the service's
 * `findOne` and `replaceOne` calls.
 *
 * @returns The stub and the spy on its writes.
 */
function createDatabase() {
    let stored: Record<string, unknown> | null = null;
    const replaceOne = vi.fn(async (_filter: unknown, document: Record<string, unknown>) => {
        stored = document;
    });
    const collection = {
        findOne: vi.fn(async () => stored),
        replaceOne
    };
    const database = { getCollection: vi.fn(() => collection) } as unknown as IDatabaseService;
    return { database, replaceOne };
}

/** A logger stub whose calls are ignored. */
function createLogger(): ISystemLogService {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as unknown as ISystemLogService;
}

/** An address converter stub that tags the hex address so the test can see it was converted. */
const addressService = {
    convertAddress: ({ hex }: { hex: string }) => ({ hex, base58check: `T-${hex}` })
} as unknown as AddressService;

describe('StakingRewardsService', () => {
    let source: IStakingRewardsSource & { getBrokerage: ReturnType<typeof vi.fn>; listWitnesses: ReturnType<typeof vi.fn> };
    let chainParameters: IChainParametersService;

    beforeEach(() => {
        source = {
            listWitnesses: vi.fn(async () => Array.from({ length: 140 }, (_, index) => ({
                address: `41${String(index).padStart(40, '0')}`,
                url: `https://sr-${index}.example`,
                voteCount: index === 139 ? 0 : 1_000_000 + index
            }))),
            getBrokerage: vi.fn(async () => 10)
        };
        chainParameters = createChainParameters({ blockRewardSun: 8_000_000, voteRewardSun: 128_000_000 });
    });

    it('reads commissions for the top 127 only, stores the snapshot, and reads it back', async () => {
        const { database, replaceOne } = createDatabase();
        const service = new StakingRewardsService({ source, chainParameters, database, addressService, logger: createLogger(), blockIntervalSeconds: 3 });

        expect(await service.getSnapshot()).toBeNull();

        const snapshot = await service.refresh();

        expect(source.getBrokerage).toHaveBeenCalledTimes(127);
        expect(snapshot.representatives).toHaveLength(127);
        expect(snapshot.representatives[0].address).toBe(`T-41${String(138).padStart(40, '0')}`);
        expect(snapshot.representatives[0].commissionPercent).toBe(10);
        expect(replaceOne).toHaveBeenCalledTimes(1);
        expect(await service.getSnapshot()).toEqual(snapshot);
    });

    it('shares one refresh between callers that overlap', async () => {
        const { database } = createDatabase();
        const service = new StakingRewardsService({ source, chainParameters, database, addressService, logger: createLogger(), blockIntervalSeconds: 3 });

        const [first, second] = await Promise.all([service.refresh(), service.refresh()]);

        expect(first).toBe(second);
        expect(source.listWitnesses).toHaveBeenCalledTimes(1);
    });

    it('stores nothing, and calls TronGrid for nothing, when the chain parameters snapshot lacks a reward rate', async () => {
        const { database, replaceOne } = createDatabase();
        const withoutVoteReward = createChainParameters({ blockRewardSun: 8_000_000 });
        const service = new StakingRewardsService({ source, chainParameters: withoutVoteReward, database, addressService, logger: createLogger(), blockIntervalSeconds: 3 });

        await expect(service.refresh()).rejects.toThrow('voteRewardSun');
        expect(source.listWitnesses).not.toHaveBeenCalled();
        expect(replaceOne).not.toHaveBeenCalled();
    });
});
