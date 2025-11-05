import type { IPluginContext } from '@tronrelic/types';
import { BaseMarketFetcher } from '../base/base-fetcher.js';
import type { MarketSnapshot } from '../../../shared/types/market-snapshot.dto.js';
import { computeOrderApy } from '../helpers/market-apy.js';
import { executeWithRetry } from '../helpers/retry.js';
import { marketProviderConfig } from '../../config/market-providers.js';

const MARKET_GUID = 'tron-save';

interface GraphQlResponse<T> {
    data: T;
    errors?: Array<{ message: string }>;
}

interface MarketOverviewData {
    market: {
        resources: {
            totalAvailableEnergy: number;
            totalLimitEnergy: number;
            totalAvailableBandwidth: number;
            totalLimitBandwidth: number;
        };
    };
}

interface EstimateMinPriceData {
    market: {
        estimateMinPrice: number;
    };
}

interface OrdersData {
    orders: Array<{
        createdAt: number;
        resourceType: 'ENERGY' | 'BANDWIDTH';
        remainAmount: number;
        resourceAmount: number;
        durationSec: number;
        paymentAmount: number;
    }>;
}

/**
 * Fetcher for Tron Save energy rental marketplace.
 *
 * Tron Save uses a GraphQL API with three query types:
 * - Market overview: Total/available energy and bandwidth
 * - Estimate min price: Minimum cost for specific durations
 * - Orders: Marketplace orders (peer-to-peer rentals)
 *
 * Data is fetched in parallel for performance.
 */
export class TronSaveFetcher extends BaseMarketFetcher {
    constructor(context: IPluginContext) {
        super(context, {
            name: 'Tron Save 能量 租赁',
            guid: MARKET_GUID
        });
    }

    private async executeGraphQl<T>(payload: Record<string, unknown>) {
        const response = await executeWithRetry(
            () =>
                this.context.http.post<GraphQlResponse<T>>(marketProviderConfig.tronSave.endpoints.graphql, payload, {
                    timeout: this.timeoutMs,
                    headers: {
                        'Content-Type': 'application/json',
                        Referer: marketProviderConfig.tronSave.siteLinks?.[0]?.link ?? 'https://tronsave.io',
                        Origin: marketProviderConfig.tronSave.siteLinks?.[0]?.link ?? 'https://tronsave.io'
                    }
                }),
            {
                logger: this.context.logger,
                fetcher: this.name,
                marketGuid: this.guid,
                requestLabel: 'graphql'
            }
        );

        if (response.data.errors?.length) {
            const [first] = response.data.errors;
            throw new Error(first?.message ?? 'Tron Save GraphQL error');
        }

        return response.data.data;
    }

    private async loadMarketOverview() {
        return this.executeGraphQl<MarketOverviewData>({
            operationName: 'GetMarketOverview',
            variables: {
                resourceType: 'ENERGY',
                resourceType2: 'BANDWIDTH',
                to: null
            },
            query:
                'query GetMarketOverview($resourceType: EResourceType!, $resourceType2: EResourceType!, $to: Float) {\n  market {\n    apyEnergy: apy(resourceType: $resourceType)\n    resourceRecoverAmountEnergy: resourceRecoverAmount(resourceType: $resourceType, to: $to)\n    apyBandwidth: apy(resourceType: $resourceType2)\n    resourceRecoverAmountBandwidth: resourceRecoverAmount(resourceType: $resourceType2, to: $to)\n    resources {\n      totalAvailableBandwidth\n      totalAvailableEnergy\n      totalLimitBandwidth\n      totalLimitEnergy\n      __typename\n    }\n    __typename\n  }\n}'
        });
    }

    private async loadEstimateMinPrice(durationSeconds: number) {
        return this.executeGraphQl<EstimateMinPriceData>({
            operationName: 'EstimateMinPrice',
            query:
                'query EstimateMinPrice($resourceType: EResourceType!, $buyAmount: Float!, $durationSec: Float!, $address: TronAddress) {\n  market {\n    estimateMinPrice(\n      resourceType: $resourceType\n      buyAmount: $buyAmount\n      durationSec: $durationSec\n      address: $address\n    )\n    __typename\n  }\n}',
            variables: {
                resourceType: 'ENERGY',
                buyAmount: 1_000_000,
                durationSec: durationSeconds
            }
        });
    }

    private async loadOrders() {
        return this.executeGraphQl<OrdersData>({
            operationName: 'Orders',
            query:
                'query Orders($offset: Int, $limit: Int, $resourceType: EResourceType, $myAddress: TronAddress, $isOwner: Boolean, $isMatching: Boolean, $sortFilterBy: [OrderSortInput]) {\n  orders(\n    offset: $offset\n    limit: $limit\n    resourceType: $resourceType\n    myAddress: $myAddress\n    isOwner: $isOwner\n    isMatching: $isMatching\n    sortFilterBy: $sortFilterBy\n  ) {\n    createdAt\n    resourceType\n    remainAmount\n    resourceAmount\n    durationSec\n    paymentAmount\n    __typename\n  }\n}',
            variables: {
                offset: 0,
                limit: 100,
                resourceType: 'ENERGY',
                isOwner: false,
                isMatching: false
            }
        });
    }

    async pull(): Promise<MarketSnapshot | null> {
        const results = await Promise.allSettled([
            this.loadMarketOverview(),
            this.loadEstimateMinPrice(60 * 60),
            this.loadEstimateMinPrice(60 * 60 * 24),
            this.loadEstimateMinPrice(60 * 60 * 24 * 3),
            this.loadOrders()
        ]);

        const [overviewResult, price1hResult, price1dResult, price3dResult, ordersResult] = results;

        const overview = overviewResult.status === 'fulfilled' ? overviewResult.value : undefined;
        const price1h = price1hResult.status === 'fulfilled' ? price1hResult.value : undefined;
        const price1d = price1dResult.status === 'fulfilled' ? price1dResult.value : undefined;
        const price3d = price3dResult.status === 'fulfilled' ? price3dResult.value : undefined;
        const orders = ordersResult.status === 'fulfilled' ? ordersResult.value?.orders ?? [] : [];

        const resources = overview?.market?.resources;

        // Build fees array with duration and per-unit price
        const fees = [
            { minutes: 60, price: price1h?.market?.estimateMinPrice },
            { minutes: 60 * 24, price: price1d?.market?.estimateMinPrice },
            { minutes: 60 * 24 * 3, price: price3d?.market?.estimateMinPrice }
        ]
            .filter((entry): entry is { minutes: number; price: number } =>
                typeof entry.price === 'number' && Number.isFinite(entry.price)
            )
            .map(entry => {
                // Use chainParameters from context for APY calculation
                const apy =
                    this.context.chainParameters?.getAPY?.(1_000_000, entry.price, entry.minutes / (60 * 24)) ??
                    undefined;

                return {
                    minutes: entry.minutes,
                    sun: entry.price,
                    apy
                };
            });

        let orderMaxBuyerAPY: number | undefined;
        let orderMaxSellerAPY: number | undefined;

        const orderSnapshots = orders
            .filter(order => order.resourceType === 'ENERGY' && order.remainAmount > 0)
            .map(order => {
                const buyerAPY = computeOrderApy({
                    trEnergy: this.context.chainParameters,
                    energy: order.resourceAmount,
                    paymentSun: order.paymentAmount,
                    durationSeconds: order.durationSec,
                    marketFee: 0.25,
                    deductFee: false
                });
                const sellerAPY = computeOrderApy({
                    trEnergy: this.context.chainParameters,
                    energy: order.resourceAmount,
                    paymentSun: order.paymentAmount,
                    durationSeconds: order.durationSec,
                    marketFee: 0.25,
                    deductFee: true
                });

                if (buyerAPY !== undefined) {
                    orderMaxBuyerAPY = orderMaxBuyerAPY === undefined ? buyerAPY : Math.max(orderMaxBuyerAPY, buyerAPY);
                }
                if (sellerAPY !== undefined) {
                    orderMaxSellerAPY = orderMaxSellerAPY === undefined ? sellerAPY : Math.max(orderMaxSellerAPY, sellerAPY);
                }

                return {
                    energy: order.resourceAmount,
                    created: order.createdAt,
                    duration: order.durationSec,
                    payment: order.paymentAmount,
                    buyerAPY,
                    sellerAPY
                };
            });

        const snapshot: MarketSnapshot = {
            guid: this.guid,
            name: this.name,
            priority: 1,
            energy: {
                total: resources?.totalLimitEnergy ?? 0,
                available: resources?.totalAvailableEnergy ?? 0,
                price: undefined
            },
            bandwidth: resources
                ? {
                      total: resources.totalLimitBandwidth ?? 0,
                      available: resources.totalAvailableBandwidth ?? 0
                  }
                : undefined,
            addresses: marketProviderConfig.tronSave.addresses ?? [],
            social: marketProviderConfig.tronSave.social,
            siteLinks: marketProviderConfig.tronSave.siteLinks,
            fees,
            orders: orderSnapshots,
            description:
                'TRONSAVE brings an extraordinary experience to the TRON community. 1st Prize in Builder Hackatron S5. Users can quickly buy Energy directly through TronSave. Quickly integrate your DApp.',
            iconHtml: '<div class="tr-tronsave-icon"></div>',
            stats: {
                orderMaxBuyerAPY,
                orderMaxSellerAPY
            },
            isActive: true,
            metadata: {
                source: 'tronsave',
                endpoint: marketProviderConfig.tronSave.endpoints.graphql
            }
        };

        return snapshot;
    }
}
