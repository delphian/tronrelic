/**
 * @fileoverview Computes, stores, and serves the staking rewards snapshot.
 *
 * A Super Representative's voter reward depends on its commission, and TRON
 * exposes commission one representative per call. A full refresh is therefore
 * about 130 TronGrid requests on the queue block sync shares, so it runs on a
 * schedule (`tools:staking-rewards-refresh`) and the result is stored. Page
 * renders, the widget, and the public endpoint only ever read the stored copy.
 *
 * - Storage: one document in `module_tools_staking_rewards`, replaced on
 *   every refresh. Nothing is kept from earlier refreshes.
 * - Inputs: the reward rates from core's `chain-parameters` service, which
 *   polls `/wallet/getchainparameters` every 10 minutes;
 *   `/wallet/listwitnesses` for votes; `/wallet/getBrokerage` per representative.
 */

import type { IChainParametersService, IDatabaseService, IStakingRewardsSnapshot, ISystemLogService } from '@/types';
import type { AddressService } from './address.service.js';
import type { IStakingRewardsSource } from './IStakingRewardsSource.js';
import {
    buildStakingRewardsSnapshot,
    REWARDED_REPRESENTATIVE_COUNT,
    type IStakingRewardsRepresentativeInput
} from './buildStakingRewardsSnapshot.js';

/** Collection holding the latest snapshot, under the module's `module_tools_` prefix. */
export const STAKING_REWARDS_COLLECTION = 'module_tools_staking_rewards';

/** The fixed `_id` of the single stored snapshot document. */
const SNAPSHOT_DOCUMENT_ID = 'latest';

/** The stored document: the snapshot plus its fixed id. */
interface IStakingRewardsDocument extends IStakingRewardsSnapshot {
    _id: string;
}

/**
 * Collaborators the service needs, passed in so tests can supply stubs.
 */
export interface IStakingRewardsServiceDependencies {
    /** TronGrid reads for votes and commissions. */
    source: IStakingRewardsSource;
    /** Core's chain parameters, which carry the per-block reward rates. */
    chainParameters: IChainParametersService;
    /** Database the snapshot is stored in. */
    database: IDatabaseService;
    /** Converts the hex addresses TronGrid lists into Base58 for display. */
    addressService: AddressService;
    /** The tools module's logger, so refresh entries reach its Logs tab. */
    logger: ISystemLogService;
    /** Seconds between blocks, from the blockchain configuration. */
    blockIntervalSeconds: number;
}

/**
 * Owner of the staking rewards snapshot: refreshes it from the chain and
 * reads it back for the calculator.
 */
export class StakingRewardsService {
    private readonly source: IStakingRewardsSource;
    private readonly chainParameters: IChainParametersService;
    private readonly database: IDatabaseService;
    private readonly addressService: AddressService;
    private readonly logger: ISystemLogService;
    private readonly blockIntervalSeconds: number;

    /**
     * The refresh in progress, if any. A second caller, such as a scheduled
     * run landing during the startup fill, joins it instead of sending another
     * 130 requests.
     */
    private inFlight: Promise<IStakingRewardsSnapshot> | null = null;

    /**
     * @param deps - TronGrid source, chain parameters, database, address converter, logger, and block interval.
     */
    constructor(deps: IStakingRewardsServiceDependencies) {
        this.source = deps.source;
        this.chainParameters = deps.chainParameters;
        this.database = deps.database;
        this.addressService = deps.addressService;
        this.logger = deps.logger;
        this.blockIntervalSeconds = deps.blockIntervalSeconds;
    }

    /**
     * Read the stored snapshot.
     *
     * @returns The latest snapshot, or null before the first refresh has finished.
     */
    async getSnapshot(): Promise<IStakingRewardsSnapshot | null> {
        const document = await this.database
            .getCollection<IStakingRewardsDocument>(STAKING_REWARDS_COLLECTION)
            .findOne({ _id: SNAPSHOT_DOCUMENT_ID });

        let snapshot: IStakingRewardsSnapshot | null = null;
        if (document) {
            const { _id, ...stored } = document;
            snapshot = stored;
        }

        return snapshot;
    }

    /**
     * Recompute every representative's reward from the chain and replace the
     * stored snapshot. Concurrent calls share one refresh.
     *
     * @returns The snapshot just stored.
     * @throws Error when a TronGrid read fails or a reward rate is missing; the
     *   previous snapshot stays in place, so the calculator keeps working.
     */
    async refresh(): Promise<IStakingRewardsSnapshot> {
        if (!this.inFlight) {
            this.inFlight = this.runRefresh().finally(() => {
                this.inFlight = null;
            });
        }

        return this.inFlight;
    }

    /**
     * Do one refresh: read the rates and votes, read each top-127
     * representative's commission one at a time, compute, and store.
     */
    private async runRefresh(): Promise<IStakingRewardsSnapshot> {
        const startedAt = Date.now();
        const { parameters } = await this.chainParameters.getParameters();
        const blockRewardSun = this.requireRate(parameters.blockRewardSun, 'blockRewardSun');
        const voteRewardSun = this.requireRate(parameters.voteRewardSun, 'voteRewardSun');

        const witnesses = await this.source.listWitnesses();

        // Only the top 127 earn anything, so only their commissions are read.
        const top = witnesses
            .filter(witness => (witness.voteCount ?? 0) > 0)
            .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0))
            .slice(0, REWARDED_REPRESENTATIVE_COUNT);

        // One at a time on purpose: the shared queue serializes the calls
        // anyway, and firing 127 at once would sit in front of block sync.
        const representatives: IStakingRewardsRepresentativeInput[] = [];
        for (const witness of top) {
            const commissionPercent = await this.source.getBrokerage(witness.address);
            representatives.push({
                address: this.addressService.convertAddress({ hex: witness.address }).base58check,
                url: witness.url ?? '',
                votes: witness.voteCount ?? 0,
                commissionPercent
            });
        }

        const snapshot = buildStakingRewardsSnapshot({
            fetchedAt: new Date(),
            blockRewardSun,
            voteRewardSun,
            blockIntervalSeconds: this.blockIntervalSeconds,
            representatives
        });

        await this.database
            .getCollection<IStakingRewardsDocument>(STAKING_REWARDS_COLLECTION)
            // The replacement carries no `_id`: MongoDB refuses one there, and
            // an upsert takes it from the filter.
            .replaceOne({ _id: SNAPSHOT_DOCUMENT_ID }, snapshot, { upsert: true });

        this.logger.info(
            {
                representatives: snapshot.representatives.length,
                blockRewardTrx: snapshot.blockRewardTrx,
                voteRewardTrx: snapshot.voteRewardTrx,
                durationMs: Date.now() - startedAt
            },
            'Staking rewards snapshot refreshed'
        );

        return snapshot;
    }

    /**
     * Check one reward rate from the chain parameters snapshot.
     *
     * A missing rate throws rather than defaulting, because a guessed rate
     * would publish wrong rewards with nothing to show they were guessed. It is
     * missing when the stored snapshot predates the field or is the service's
     * built-in fallback; the next chain parameters fetch fills it in.
     *
     * @param value - The rate as the snapshot holds it.
     * @param name - The field name, for the error message.
     * @returns The rate in SUN.
     */
    private requireRate(value: number | undefined, name: string): number {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            throw new Error(`The chain parameters snapshot has no usable ${name} yet`);
        }

        return value;
    }
}
