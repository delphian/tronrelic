import type { IUsdtParametersService } from '@tronrelic/types';
import type { MarketDocument, AddressMetadata, MarketOrder, MarketSiteLink, MarketSocialLink } from '@tronrelic/shared';
import type { MarketSnapshot } from '../../shared/types/market-snapshot.dto.js';
import { computePricingDetail } from './pricing-matrix-calculator.js';

const ENERGY_BASE_UNIT = 32_000;

/**
 * Normalizes diverse market API responses into standardized MarketDocument format.
 *
 * Transforms raw market snapshots by:
 * - Computing pricing matrices across energy/duration buckets
 * - Calculating USDT transfer costs with energy regeneration
 * - Normalizing addresses, social links, and site links
 * - Computing availability percentages and effective pricing
 */

function normalizeAddresses(addresses: MarketSnapshot['addresses'] = []): AddressMetadata[] {
    return addresses.map(entry => ({
        address: entry.address,
        description: entry.description,
        type: entry.type ?? null,
        labels: entry.labels ?? []
    }));
}

function normalizeSocial(social: MarketSnapshot['social'] = []): MarketSocialLink[] {
    return social.map(entry => ({
        platform: entry.platform,
        link: entry.link,
        icon: entry.icon,
        label: entry.label,
        verified: entry.verified
    }));
}

function normalizeSiteLinks(siteLinks: MarketSnapshot['siteLinks'] = []): MarketSiteLink[] {
    return siteLinks.map(link => ({
        link: link.link,
        text: link.text,
        conversion: link.conversion
    }));
}

function calculateAvailability(snapshot: MarketSnapshot): number {
    if (!snapshot.energy.total) {
        return 0;
    }
    const available = snapshot.energy.available ?? 0;
    return Math.round((available / snapshot.energy.total) * 100);
}

function calculateEffectivePrice(snapshot: MarketSnapshot): number | undefined {
    const minOrder = snapshot.energy.minOrder || ENERGY_BASE_UNIT;
    const price = snapshot.energy.price;

    if (price != null) {
        if (!minOrder || minOrder === ENERGY_BASE_UNIT) {
            return Number(price.toFixed(4));
        }

        // Scale price to standard unit (32k energy)
        const multiplier = minOrder / ENERGY_BASE_UNIT;
        return Number((price / multiplier).toFixed(4));
    }

    return undefined;
}

/**
 * Normalizes a market snapshot into a standardized document format.
 *
 * @param usdtService - USDT parameters service for transfer cost calculations
 * @param snapshot - Raw market snapshot from fetcher
 * @param reliability - Optional reliability score from reliability service
 * @returns Normalized market document with computed pricing details
 */
export async function normalizeMarket(
    usdtService: IUsdtParametersService,
    snapshot: MarketSnapshot,
    reliability?: number
): Promise<MarketDocument> {
    const availabilityPercent = snapshot.availabilityPercent ?? calculateAvailability(snapshot);
    const effectivePrice = snapshot.effectivePrice ?? calculateEffectivePrice(snapshot);
    const pricingDetail = await computePricingDetail(usdtService, snapshot.fees, snapshot.orders as MarketOrder[] | undefined);
    const affiliate = snapshot.affiliate
        ? {
              link: snapshot.affiliate.link,
              commission: snapshot.affiliate.commission,
              cookieDuration: snapshot.affiliate.cookieDuration
          }
        : undefined;

    const energy = {
        total: snapshot.energy.total,
        available: snapshot.energy.available,
        price: snapshot.energy.price,
        minOrder: snapshot.energy.minOrder ?? ENERGY_BASE_UNIT,
        maxOrder: snapshot.energy.maxOrder,
        unit: snapshot.energy.unit
    };

    return {
        id: snapshot.guid,
        guid: snapshot.guid,
        name: snapshot.name,
        priority: snapshot.priority,
        energy,
        bandwidth: snapshot.bandwidth,
        addresses: normalizeAddresses(snapshot.addresses),
        social: normalizeSocial(snapshot.social),
        siteLinks: normalizeSiteLinks(snapshot.siteLinks),
        fees: snapshot.fees,
        orders: snapshot.orders as MarketOrder[] | undefined,
        affiliate,
        description: snapshot.description,
        iconHtml: snapshot.iconHtml,
        contract: snapshot.contract,
        metadata: snapshot.metadata,
        lastUpdated: new Date().toISOString(),
        isActive: snapshot.isActive,
        reliability,
        averageDeliveryTime: snapshot.averageDeliveryTime,
        supportedRegions: snapshot.supportedRegions,
        stats: snapshot.stats,
        availabilityPercent,
        effectivePrice,
        pricingDetail
    };
}
