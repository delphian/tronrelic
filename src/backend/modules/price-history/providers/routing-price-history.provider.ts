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
import { PriceVendorsFailedError, type IPriceVendorFailure } from './PriceVendorsFailedError.js';

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
     * nothing about the asset has been learned.
     *
     * A vendor that throws anything other than disabled is logged with its id
     * and the next vendor is tried, so one vendor's outage or bad credentials
     * does not stop a later vendor from pricing the asset. If no vendor prices
     * it and any vendor threw, the call throws `PriceVendorsFailedError`
     * naming each failed vendor. It does not return `empty`, because a vendor
     * that failed has not said the range holds no price, and the service must
     * retry the tick rather than park the asset as unpriced.
     *
     * @param asset - The asset to price.
     * @param fromDay - Inclusive start UTC `YYYY-MM-DD`.
     * @param toDay - Inclusive end UTC `YYYY-MM-DD`.
     * @returns The verdict, the winning vendor's points, and which vendors were asked, skipped, or failed.
     * @throws PriceVendorsFailedError when nothing priced the asset and at least one vendor threw.
     */
    async fetchRange(asset: PriceAsset, fromDay: string, toDay: string): Promise<IPriceRangeOutcome> {
        const candidates = await this.candidatesFor(asset);
        const asked: string[] = [];
        const skipped: string[] = [];
        const failed: IPriceVendorFailure[] = [];
        let points: ISourcedPricePoint[] = [];
        for (const provider of candidates) {
            let answer: ISourcedPricePoint[];
            try {
                answer = await provider.fetchRange(asset, fromDay, toDay);
            } catch (error) {
                if (error instanceof ProviderDisabledError) {
                    this.logger.debug({ asset, vendor: provider.id }, 'Price vendor disabled; skipping');
                    skipped.push(provider.id);
                } else {
                    const message = error instanceof Error ? error.message : String(error);
                    this.logger.warn({ asset, vendor: provider.id, fromDay, toDay, error: message }, 'Price vendor failed; trying the next vendor');
                    failed.push({ vendor: provider.id, message });
                }
                continue;
            }
            asked.push(provider.id);
            if (answer.length > 0) {
                points = answer;
                break;
            }
        }
        if (points.length === 0 && failed.length > 0) {
            throw new PriceVendorsFailedError(failed);
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
        return { verdict, points, asked, skipped, failed };
    }
}
