/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketQueryService } from '../market-query.service.js';
import type { ILogger } from '@tronrelic/types';

/**
 * Mock logger implementation for testing.
 * Provides a complete ILogger interface with spy functions.
 */
class MockLogger implements ILogger {
    public level = 'info';
    public silent = vi.fn();
    public msgPrefix = '';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>, _options?: Record<string, unknown>): ILogger => {
        return this;
    });
}

/**
 * Mock market data structure matching the API response format.
 */
interface MockMarket {
    guid: string;
    name: string;
    isActive: boolean;
    lastUpdated: Date;
    pricingDetail?: {
        minUsdtTransferCost?: number;
        usdtTransferCosts?: Array<{
            durationMinutes: number;
            costTrx: number;
        }>;
    };
}

/**
 * Creates a mock market with USDT transfer costs for testing.
 *
 * @param overrides - Partial market data to override defaults
 * @returns Mock market object with pricing detail
 */
function createMockMarket(overrides: Partial<MockMarket> = {}): MockMarket {
    return {
        guid: 'test-market',
        name: 'Test Market',
        isActive: true,
        lastUpdated: new Date(),
        pricingDetail: {
            minUsdtTransferCost: 0.001,
            usdtTransferCosts: [
                { durationMinutes: 60, costTrx: 0.005 },      // 1 hour
                { durationMinutes: 180, costTrx: 0.004 },     // 3 hours
                { durationMinutes: 1440, costTrx: 0.003 },    // 1 day
                { durationMinutes: 4320, costTrx: 0.0025 },   // 3 days
                { durationMinutes: 10080, costTrx: 0.002 },   // 7 days
                { durationMinutes: 43200, costTrx: 0.0015 }   // 30 days
            ]
        },
        ...overrides
    };
}

describe('MarketQueryService - Single Market Tests', () => {
    let service: MarketQueryService;
    let mockLogger: MockLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = new MockLogger();
        service = new MarketQueryService('http://test-api', mockLogger as any);
    });

    /**
     * Test: Should find correct price for 1 day rental.
     *
     * Verifies that the service correctly identifies and returns pricing data
     * for a 1-day (1440 minutes) rental period from a single market.
     */
    it('should find correct price for 1 day rental (1440 minutes)', async () => {
        const mockMarket = createMockMarket();

        // Mock axios to return single market
        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 1 });

        expect(result).toContain('Test Market');
        expect(result).toContain('0.003000 TRX'); // 1 day cost
        expect(result).toContain('<b>Duration:</b> 1 day');
    });

    /**
     * Test: Should find correct price for 3 day rental.
     *
     * Verifies that the service correctly calculates 3 days = 4320 minutes
     * and retrieves the appropriate pricing tier.
     */
    it('should find correct price for 3 day rental (4320 minutes)', async () => {
        const mockMarket = createMockMarket();

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 3 });

        expect(result).toContain('Test Market');
        expect(result).toContain('0.002500 TRX'); // 3 day cost
        expect(result).toContain('<b>Duration:</b> 3 days');
    });

    /**
     * Test: Should find correct price for 7 day rental.
     *
     * Verifies correct lookup for weekly rentals (10080 minutes).
     */
    it('should find correct price for 7 day rental (10080 minutes)', async () => {
        const mockMarket = createMockMarket();

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 7 });

        expect(result).toContain('Test Market');
        expect(result).toContain('0.002000 TRX'); // 7 day cost
        expect(result).toContain('<b>Duration:</b> 7 days');
    });

    /**
     * Test: Should find correct price for 30 day rental.
     *
     * Verifies correct lookup for monthly rentals (43200 minutes).
     */
    it('should find correct price for 30 day rental (43200 minutes)', async () => {
        const mockMarket = createMockMarket();

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 30 });

        expect(result).toContain('Test Market');
        expect(result).toContain('0.001500 TRX'); // 30 day cost
        expect(result).toContain('<b>Duration:</b> 30 days');
    });

    /**
     * Test: Should calculate total cost for multiple transfers.
     *
     * Verifies that when a user requests multiple USDT transfers,
     * the service multiplies the per-transfer cost correctly.
     */
    it('should calculate total cost for 10 transfers over 1 day', async () => {
        const mockMarket = createMockMarket();

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 10, days: 1 });

        expect(result).toContain('<b>Transfers:</b> 10');
        expect(result).toContain('<b>Cost per transfer:</b> 0.003000 TRX');
        expect(result).toContain('<b>Total cost:</b> 0.030000 TRX'); // 10 * 0.003
    });

    /**
     * Test: Should calculate total cost for 100 transfers over 7 days.
     *
     * Verifies correct multiplication for larger transfer counts.
     */
    it('should calculate total cost for 100 transfers over 7 days', async () => {
        const mockMarket = createMockMarket();

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 100, days: 7 });

        expect(result).toContain('<b>Transfers:</b> 100');
        expect(result).toContain('<b>Cost per transfer:</b> 0.002000 TRX');
        expect(result).toContain('<b>Total cost:</b> 0.200000 TRX'); // 100 * 0.002
    });

    /**
     * Test: Should return error when duration not available.
     *
     * Verifies that if a market doesn't offer the requested duration,
     * the service returns an appropriate error message.
     */
    it('should return error when requested duration not available', async () => {
        const mockMarket = createMockMarket({
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.003 } // Only 1 day available
                ]
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 7 });

        expect(result).toContain('No markets found for 7 day rental');
    });

    /**
     * Test: Should ignore inactive markets.
     *
     * Verifies that markets with isActive: false are not considered
     * when searching for the best price.
     */
    it('should ignore inactive markets', async () => {
        const mockMarket = createMockMarket({ isActive: false });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 1 });

        expect(result).toContain('No markets found for 1 day rental');
    });

    /**
     * Test: Should ignore markets without pricing detail.
     *
     * Verifies that markets missing the pricingDetail field are skipped.
     */
    it('should ignore markets without pricing detail', async () => {
        const mockMarket = createMockMarket({ pricingDetail: undefined });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 1 });

        expect(result).toContain('No markets found for 1 day rental');
    });

    /**
     * Test: Should ignore markets with empty usdtTransferCosts.
     *
     * Verifies that markets with an empty pricing array are skipped.
     */
    it('should ignore markets with empty usdtTransferCosts array', async () => {
        const mockMarket = createMockMarket({
            pricingDetail: {
                usdtTransferCosts: []
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [mockMarket]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 1 });

        expect(result).toContain('No markets found for 1 day rental');
    });
});

describe('MarketQueryService - Multi-Market Comparison Tests', () => {
    let service: MarketQueryService;
    let mockLogger: MockLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = new MockLogger();
        service = new MarketQueryService('http://test-api', mockLogger as any);
    });

    /**
     * Test: Should find cheapest market among multiple options for 1 day.
     *
     * Verifies that when multiple markets offer 1-day rentals,
     * the service returns the one with the lowest cost.
     */
    it('should find cheapest market among multiple options for 1 day', async () => {
        const market1 = createMockMarket({
            guid: 'expensive-market',
            name: 'Expensive Market',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.010 } // High cost
                ]
            }
        });

        const market2 = createMockMarket({
            guid: 'cheap-market',
            name: 'Cheap Market',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.002 } // Low cost
                ]
            }
        });

        const market3 = createMockMarket({
            guid: 'medium-market',
            name: 'Medium Market',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.005 } // Medium cost
                ]
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [market1, market2, market3]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 1 });

        expect(result).toContain('Cheap Market'); // Should pick cheapest
        expect(result).toContain('0.002000 TRX');
        expect(result).not.toContain('Expensive Market');
        expect(result).not.toContain('Medium Market');
    });

    /**
     * Test: Should find cheapest market for 7 day rentals.
     *
     * Verifies correct comparison when duration is 7 days (10080 minutes).
     */
    it('should find cheapest market among multiple options for 7 days', async () => {
        const market1 = createMockMarket({
            guid: 'market-a',
            name: 'Market A',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 10080, costTrx: 0.008 }
                ]
            }
        });

        const market2 = createMockMarket({
            guid: 'market-b',
            name: 'Market B',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 10080, costTrx: 0.003 } // Cheapest
                ]
            }
        });

        const market3 = createMockMarket({
            guid: 'market-c',
            name: 'Market C',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 10080, costTrx: 0.006 }
                ]
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [market1, market2, market3]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 7 });

        expect(result).toContain('Market B');
        expect(result).toContain('0.003000 TRX');
    });

    /**
     * Test: Should handle markets with different duration offerings.
     *
     * Verifies that the service only compares markets that offer the requested duration,
     * ignoring markets that don't have that duration available.
     */
    it('should only compare markets offering the requested duration', async () => {
        const market1 = createMockMarket({
            guid: 'market-1day-only',
            name: 'Market 1-Day Only',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.001 } // Only 1 day
                ]
            }
        });

        const market2 = createMockMarket({
            guid: 'market-7day',
            name: 'Market 7-Day',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 10080, costTrx: 0.005 } // Has 7 day
                ]
            }
        });

        const market3 = createMockMarket({
            guid: 'market-7day-cheaper',
            name: 'Market 7-Day Cheaper',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 10080, costTrx: 0.003 } // Has 7 day, cheaper
                ]
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [market1, market2, market3]
                    }
                })
            }
        }));

        // Request 7 day rental - should ignore market1
        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 7 });

        expect(result).toContain('Market 7-Day Cheaper');
        expect(result).toContain('0.003000 TRX');
        expect(result).not.toContain('Market 1-Day Only');
    });

    /**
     * Test: Should handle mix of active and inactive markets.
     *
     * Verifies that inactive markets are excluded from comparison
     * even if they have the best price.
     */
    it('should exclude inactive markets from comparison', async () => {
        const market1 = createMockMarket({
            guid: 'inactive-cheap',
            name: 'Inactive Cheap Market',
            isActive: false, // Inactive!
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.001 } // Cheapest but inactive
                ]
            }
        });

        const market2 = createMockMarket({
            guid: 'active-market',
            name: 'Active Market',
            isActive: true,
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.005 } // More expensive but active
                ]
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [market1, market2]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 1 });

        expect(result).toContain('Active Market'); // Should pick active, not cheapest
        expect(result).toContain('0.005000 TRX');
        expect(result).not.toContain('Inactive Cheap Market');
    });

    /**
     * Test: Should handle markets with varying cost structures.
     *
     * Verifies that markets can have different duration offerings,
     * and the service finds the best match for each requested duration independently.
     */
    it('should handle markets with different duration availability', async () => {
        const marketShortTerm = createMockMarket({
            guid: 'short-term',
            name: 'Short Term Market',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 60, costTrx: 0.010 },
                    { durationMinutes: 1440, costTrx: 0.005 }
                    // No 7-day offering
                ]
            }
        });

        const marketLongTerm = createMockMarket({
            guid: 'long-term',
            name: 'Long Term Market',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.008 }, // More expensive 1-day
                    { durationMinutes: 10080, costTrx: 0.002 } // But has 7-day
                ]
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [marketShortTerm, marketLongTerm]
                    }
                })
            }
        }));

        // For 1-day, short-term is cheaper
        const result1day = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 1 });
        expect(result1day).toContain('Short Term Market');
        expect(result1day).toContain('0.005000 TRX');

        // For 7-day, only long-term offers it
        const result7day = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 7 });
        expect(result7day).toContain('Long Term Market');
        expect(result7day).toContain('0.002000 TRX');
    });

    /**
     * Test: Should calculate correct total cost for multiple transfers across markets.
     *
     * Verifies that when comparing markets for bulk transfers, the total cost
     * is calculated correctly (per-transfer cost * transfer count).
     */
    it('should calculate correct total cost for 50 transfers across markets', async () => {
        const market1 = createMockMarket({
            guid: 'market-1',
            name: 'Market 1',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.004 }
                ]
            }
        });

        const market2 = createMockMarket({
            guid: 'market-2',
            name: 'Market 2',
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.003 } // Cheaper
                ]
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [market1, market2]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 50, days: 1 });

        expect(result).toContain('Market 2'); // Cheaper market
        expect(result).toContain('<b>Transfers:</b> 50');
        expect(result).toContain('<b>Cost per transfer:</b> 0.003000 TRX');
        expect(result).toContain('<b>Total cost:</b> 0.150000 TRX'); // 50 * 0.003
    });

    /**
     * Test: Should return error when no markets offer requested duration.
     *
     * Verifies that if none of the markets have the requested duration,
     * an appropriate error message is returned.
     */
    it('should return error when no markets offer requested duration', async () => {
        const market1 = createMockMarket({
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.003 } // Only 1 day
                ]
            }
        });

        const market2 = createMockMarket({
            pricingDetail: {
                usdtTransferCosts: [
                    { durationMinutes: 1440, costTrx: 0.004 } // Only 1 day
                ]
            }
        });

        vi.doMock('axios', () => ({
            default: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        success: true,
                        markets: [market1, market2]
                    }
                })
            }
        }));

        const result = await service.queryMarkets({ chatId: "test-chat", transferCount: 1, days: 7 });

        expect(result).toContain('No markets found for 7 day rental');
    });
});
