/**
 * @fileoverview Unit tests for the routing price-history provider.
 *
 * Locks the routing rules the service depends on: vendors are tried in the
 * operator's order for the asset's class, a vendor that cannot serve the asset
 * is never asked, a disabled vendor is skipped and recorded, an empty answer
 * falls through to the next vendor, the first non-empty answer wins, a
 * failing vendor is passed over for the next one but fails the call when no
 * vendor priced the asset (so the tick retries), and the verdict tells
 * a final empty answer apart from one a skipped vendor might have changed and
 * from a call where no vendor could be asked at all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PriceAsset, IPriceHistorySettings } from '@/types';
import {
    ProviderRegistry,
    ProviderDisabledError,
    type IPriceHistoryProvider,
    type ISourcedPricePoint
} from '../../providers/index.js';
import { COINGECKO_DESCRIPTOR, GECKOTERMINAL_DESCRIPTOR, TRONSCAN_DESCRIPTOR } from '../../providers/database/index.js';
import { DEFAULT_SETTINGS } from '../database/index.js';
import { RoutingPriceHistoryProvider } from '../providers/routing-price-history.provider.js';
import { PriceVendorsFailedError } from '../providers/PriceVendorsFailedError.js';

/** Stub logger matching the ISystemLogService shape the provider touches. */
const stubLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => stubLogger };

/**
 * A scripted vendor adapter.
 */
class ScriptedProvider implements IPriceHistoryProvider {
    public calls = 0;

    /**
     * @param id - Vendor id.
     * @param supports - Which asset classes it serves.
     * @param outcome - What `fetchRange` does: points, empty, disabled, or a transport error.
     */
    constructor(
        public readonly id: string,
        private readonly supports: 'trx' | 'tokens' | 'all',
        private readonly outcome: ISourcedPricePoint[] | 'disabled' | 'error'
    ) {}

    supportsAsset(asset: PriceAsset): boolean {
        if (this.supports === 'all') {
            return true;
        }
        return this.supports === 'trx' ? asset === 'TRX' : asset !== 'TRX';
    }

    async fetchRange(): Promise<ISourcedPricePoint[]> {
        this.calls += 1;
        if (this.outcome === 'disabled') {
            throw new ProviderDisabledError(this.id);
        }
        if (this.outcome === 'error') {
            throw new Error('timeout');
        }
        return this.outcome;
    }
}

/**
 * Build a registry with the three vendors attached to scripted adapters and a
 * routing provider over it.
 *
 * @param adapters - The adapters to attach, keyed by vendor id.
 * @param settings - Routing order overrides.
 * @returns The routing provider.
 */
function routerWith(
    adapters: Record<string, ScriptedProvider>,
    settings: Partial<IPriceHistorySettings> = {}
): RoutingPriceHistoryProvider {
    ProviderRegistry.resetInstance();
    const registry = ProviderRegistry.getInstance();
    for (const descriptor of [TRONSCAN_DESCRIPTOR, COINGECKO_DESCRIPTOR, GECKOTERMINAL_DESCRIPTOR]) {
        registry.registerVendor({ descriptor, defaults: {}, testConnection: async () => ({ ok: true, message: 'ok' }), isEnabled: async () => true });
        if (adapters[descriptor.id]) {
            registry.attachPriceHistoryProvider(descriptor.id, adapters[descriptor.id]);
        }
    }
    return new RoutingPriceHistoryProvider(registry, async () => ({ ...DEFAULT_SETTINGS, ...settings }), stubLogger as never);
}

const point = (source: string): ISourcedPricePoint => ({ asset: 'TRX', day: '2024-01-01', priceUsd: 0.1, source });

describe('RoutingPriceHistoryProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the first vendor in order that has prices, and skips vendors that cannot serve the asset', async () => {
        const tronscan = new ScriptedProvider('tronscan', 'trx', [point('tronscan')]);
        const coingecko = new ScriptedProvider('coingecko', 'all', [point('coingecko')]);
        const router = routerWith({ tronscan, coingecko }, { trxSources: ['tronscan', 'coingecko'] });

        const outcome = await router.fetchRange('TRX', '2024-01-01', '2024-01-01');

        expect(outcome.verdict).toBe('priced');
        expect(outcome.points[0].source).toBe('tronscan');
        expect(outcome.asked).toEqual(['tronscan']);
        expect(outcome.skipped).toEqual([]);
        expect(coingecko.calls).toBe(0);

        // A token never reaches TronScan, which does not support tokens.
        await router.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');
        expect(tronscan.calls).toBe(1);
    });

    it('falls through a disabled vendor and an empty answer to the next vendor', async () => {
        const coingecko = new ScriptedProvider('coingecko', 'all', 'disabled');
        const geckoterminal = new ScriptedProvider('geckoterminal', 'tokens', [point('geckoterminal')]);
        const router = routerWith({ coingecko, geckoterminal }, { tokenSources: ['coingecko', 'geckoterminal'] });

        const outcome = await router.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');
        expect(outcome.verdict).toBe('priced');
        expect(outcome.points[0].source).toBe('geckoterminal');
        expect(outcome.skipped).toEqual(['coingecko']);
        expect(outcome.asked).toEqual(['geckoterminal']);

        const emptyFirst = routerWith(
            { coingecko: new ScriptedProvider('coingecko', 'all', []), geckoterminal },
            { tokenSources: ['coingecko', 'geckoterminal'] }
        );
        const fallen = await emptyFirst.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');
        expect(fallen.verdict).toBe('priced');
        expect(fallen.points[0].source).toBe('geckoterminal');
        expect(fallen.asked).toEqual(['coingecko', 'geckoterminal']);
    });

    it('reports a final empty answer when every vendor that could serve the asset was asked', async () => {
        const router = routerWith(
            { coingecko: new ScriptedProvider('coingecko', 'all', []), geckoterminal: new ScriptedProvider('geckoterminal', 'tokens', []) },
            { tokenSources: ['coingecko', 'geckoterminal'] }
        );
        const outcome = await router.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');
        expect(outcome.verdict).toBe('empty');
        expect(outcome.points).toEqual([]);
        expect(outcome.asked).toEqual(['coingecko', 'geckoterminal']);
        expect(outcome.skipped).toEqual([]);
    });

    it('reports an inconclusive answer when a disabled vendor was skipped and the rest had nothing', async () => {
        const router = routerWith(
            { coingecko: new ScriptedProvider('coingecko', 'all', []), geckoterminal: new ScriptedProvider('geckoterminal', 'tokens', 'disabled') },
            { tokenSources: ['coingecko', 'geckoterminal'] }
        );
        const outcome = await router.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');
        expect(outcome.verdict).toBe('inconclusive');
        expect(outcome.points).toEqual([]);
        expect(outcome.asked).toEqual(['coingecko']);
        expect(outcome.skipped).toEqual(['geckoterminal']);
    });

    it('falls through a failing vendor to the next one and reports the failure', async () => {
        const geckoterminal = new ScriptedProvider('geckoterminal', 'tokens', [point('geckoterminal')]);
        const router = routerWith(
            { coingecko: new ScriptedProvider('coingecko', 'all', 'error'), geckoterminal },
            { tokenSources: ['coingecko', 'geckoterminal'] }
        );

        const outcome = await router.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');

        expect(outcome.verdict).toBe('priced');
        expect(outcome.points[0].source).toBe('geckoterminal');
        expect(outcome.failed).toEqual([{ vendor: 'coingecko', message: 'timeout' }]);
        expect(stubLogger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ vendor: 'coingecko', error: 'timeout' }),
            'Price vendor failed; trying the next vendor'
        );
    });

    it('throws an error naming the failed vendor when no vendor priced the asset', async () => {
        const router = routerWith(
            { coingecko: new ScriptedProvider('coingecko', 'all', 'error'), geckoterminal: new ScriptedProvider('geckoterminal', 'tokens', []) },
            { tokenSources: ['coingecko', 'geckoterminal'] }
        );

        // A failed vendor has not said the range is empty, so the call must fail
        // rather than return `empty` and let the service park the asset.
        const attempt = router.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');
        await expect(attempt).rejects.toBeInstanceOf(PriceVendorsFailedError);
        await expect(attempt).rejects.toThrow('coingecko: timeout');
    });

    it('reports unavailable when no vendor could be asked, so the tick learns nothing about the asset', async () => {
        const router = routerWith(
            { coingecko: new ScriptedProvider('coingecko', 'all', 'disabled') },
            { tokenSources: ['coingecko'] }
        );
        const allDisabled = await router.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');
        expect(allDisabled.verdict).toBe('unavailable');
        expect(allDisabled.asked).toEqual([]);
        expect(allDisabled.skipped).toEqual(['coingecko']);

        const unconfigured = routerWith({ coingecko: new ScriptedProvider('coingecko', 'all', [point('coingecko')]) }, { tokenSources: [] });
        const noneListed = await unconfigured.fetchRange('TTOKEN', '2024-01-01', '2024-01-01');
        expect(noneListed.verdict).toBe('unavailable');
        expect(noneListed.asked).toEqual([]);
        expect(noneListed.skipped).toEqual([]);
    });
});
