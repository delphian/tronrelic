/**
 * @fileoverview The routing price-history provider: the one `IPriceHistoryRouter`
 * the service depends on, which tries the operator's ordered vendors per asset
 * class and reports how the attempt ended.
 *
 * Why routing lives here and not in the service: the service's job is cursors
 * and storage, and it should not know that TRX and tokens come from different
 * places. Presenting the vendor list as a single source keeps the service's
 * contract unchanged whether one vendor or five are configured.
 *
 * Why the order is read per call rather than captured: the order is an operator
 * setting edited on the price-history page, and a change there must apply to
 * the next tick without a restart.
 */

import type { PriceAsset, IPriceHistorySettings, ISystemLogService } from '@/types';
import { PRICE_ASSET_TRX } from '@/types';
import {
    ProviderDisabledError,
    type IProviderRegistry,
    type IPriceHistoryProvider,
    type ISourcedPricePoint
} from '../../providers/index.js';
import type { IPriceHistoryRouter } from './IPriceHistoryRouter.js';
import type { IPriceRangeOutcome } from './IPriceRangeOutcome.js';

/**
 * Tries vendors in the configured order for an asset's class.
 */
export class RoutingPriceHistoryProvider implements IPriceHistoryRouter {
    private readonly registry: IProviderRegistry;
    private readonly readSettings: () => Promise<IPriceHistorySettings>;
    private readonly logger: ISystemLogService;

    /**
     * @param registry - Where the per-vendor implementations are looked up by id.
     * @param readSettings - Reads the current routing order; injected as a
     *   function so the provider never holds a stale copy of the settings.
     * @param logger - Child logger for routing diagnostics.
     */
    constructor(
        registry: IProviderRegistry,
        readSettings: () => Promise<IPriceHistorySettings>,
        logger: ISystemLogService
    ) {
        this.registry = registry;
        this.readSettings = readSettings;
        this.logger = logger;
    }

    /**
     * The ordered vendor implementations for an asset's class, skipping ids
     * that name no registered vendor or whose vendor cannot price the asset.
     *
     * @param asset - The asset to price.
     * @returns Providers to try, in order.
     */
    private async candidatesFor(asset: PriceAsset): Promise<IPriceHistoryProvider[]> {
        const settings = await this.readSettings();
        const order = asset === PRICE_ASSET_TRX ? settings.trxSources : settings.tokenSources;
        const candidates: IPriceHistoryProvider[] = [];
        for (const vendorId of order) {
            const provider = this.registry.getPriceHistoryProvider(vendorId);
            if (provider && provider.supportsAsset(asset)) {
                candidates.push(provider);
            }
        }
        return candidates;
    }

    /**
     * Forward a reset to every vendor that could serve the asset, so each drops
     * whatever it remembered about it.
     *
     * @param asset - The asset being reset.
     */
    forgetAsset(asset: PriceAsset): void {
        for (const vendor of this.registry.listVendorsWithCapability('price-history')) {
            vendor.priceHistory?.forgetAsset?.(asset);
        }
    }

    /**
     * Try each candidate vendor in order and report the first non-empty range.
     * A vendor that is disabled is skipped and recorded as such, because an
     * empty answer that follows a skip is not final: the skipped vendor may
     * hold the range, so the verdict is `inconclusive` rather than `empty`.
     * When no vendor could be asked at all the verdict is `unavailable`, and
     * nothing about the asset has been learned. A vendor that throws anything
     * other than disabled fails the call, because a transport failure must
     * make the tick retry rather than let a later vendor's empty answer be
     * recorded against the asset.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns The verdict, the winning vendor's points, and which vendors were asked or skipped.
     */
    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPriceRangeOutcome> {
        const candidates = await this.candidatesFor(asset);
        const asked: string[] = [];
        const skipped: string[] = [];
        let points: ISourcedPricePoint[] = [];
        for (const provider of candidates) {
            let answer: ISourcedPricePoint[];
            try {
                answer = await provider.fetchRange(asset, fromDay, toDay);
            } catch (error) {
                if (error instanceof ProviderDisabledError) {
                    this.logger.debug({ asset, vendor: provider.id }, 'Price vendor disabled; skipping');
                    skipped.push(provider.id);
                    continue;
                }
                throw error;
            }
            asked.push(provider.id);
            if (answer.length > 0) {
                points = answer;
                break;
            }
        }
        let verdict: IPriceRangeOutcome['verdict'];
        if (points.length > 0) {
            verdict = 'priced';
        } else if (asked.length === 0) {
            verdict = 'unavailable';
        } else if (skipped.length > 0) {
            verdict = 'inconclusive';
        } else {
            verdict = 'empty';
        }
        return { verdict, points, asked, skipped };
    }
}
