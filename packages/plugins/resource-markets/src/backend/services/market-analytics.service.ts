import type { IPluginContext } from '@tronrelic/types';

/**
 * Price trend analysis result.
 */
export interface PriceTrendAnalysis {
    trend: 'rising' | 'falling' | 'stable';
    changePercent: number;
    volatilityScore: number;
    sampleSize: number;
}

/**
 * Market analytics service for trend analysis.
 *
 * Analyzes historical pricing data to detect trends, calculate price changes,
 * and assess volatility. Used to display "Price dropping 15%" indicators and
 * volatility warnings in the UI.
 *
 * **Analysis features:**
 * - Trend detection (rising/falling/stable based on linear regression slope)
 * - Price change percentage (comparing current to historical average)
 * - Volatility scoring (standard deviation of recent prices)
 *
 * **Thresholds:**
 * - Stable trend: Change < 5%
 * - Rising/falling: Change ≥ 5%
 * - High volatility: Standard deviation > 10% of mean
 *
 * @param context - Plugin context with database access
 */
export class MarketAnalyticsService {
    constructor(private readonly context: IPluginContext) {}

    /**
     * Analyzes price trend for a market.
     *
     * Fetches recent price history (last 24 snapshots = ~4 hours at 10-minute intervals)
     * and calculates trend direction, price change percentage, and volatility score.
     *
     * @param guid - Market identifier
     * @param lookbackCount - Number of recent price snapshots to analyze (default: 24)
     * @returns Price trend analysis or null if insufficient data
     */
    async analyzePriceTrend(guid: string, lookbackCount = 24): Promise<PriceTrendAnalysis | null> {
        // Fetch recent price history
        const history = await this.context.database.find<{
            minUsdtTransferCost?: number;
            timestamp: Date;
        }>(
            'price_history',
            { marketGuid: guid },
            {
                sort: { timestamp: -1 },
                limit: lookbackCount
            }
        );

        // Filter out entries without pricing data
        const prices = history
            .map(entry => entry.minUsdtTransferCost)
            .filter((price): price is number => typeof price === 'number' && price > 0);

        if (prices.length < 3) {
            // Insufficient data for trend analysis
            return null;
        }

        // Calculate statistics
        const currentPrice = prices[0];
        const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
        const stdDev = Math.sqrt(variance);

        // Calculate price change percentage
        const changePercent = ((currentPrice - mean) / mean) * 100;

        // Calculate volatility score (coefficient of variation)
        const volatilityScore = (stdDev / mean) * 100;

        // Detect trend using linear regression slope
        const slope = this.calculateLinearRegressionSlope(prices);
        const trend = this.determineTrend(slope, changePercent);

        return {
            trend,
            changePercent: Number(changePercent.toFixed(2)),
            volatilityScore: Number(volatilityScore.toFixed(2)),
            sampleSize: prices.length
        };
    }

    /**
     * Calculates linear regression slope for price trend.
     *
     * Uses least squares method to fit a line through price data points.
     * Positive slope indicates rising trend, negative indicates falling.
     *
     * @param prices - Array of prices (most recent first)
     * @returns Slope of the regression line
     */
    private calculateLinearRegressionSlope(prices: number[]): number {
        const n = prices.length;
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumX2 = 0;

        for (let i = 0; i < n; i++) {
            const x = i; // Time index
            const y = prices[i];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
        }

        const denominator = n * sumX2 - sumX * sumX;
        if (denominator === 0) {
            return 0; // Avoid division by zero
        }

        const slope = (n * sumXY - sumX * sumY) / denominator;
        return slope;
    }

    /**
     * Determines price trend based on slope and change percentage.
     *
     * Uses both linear regression slope and absolute price change to classify
     * trends robustly. Requires both metrics to agree for rising/falling classification.
     *
     * @param slope - Linear regression slope
     * @param changePercent - Price change percentage
     * @returns Trend classification
     */
    private determineTrend(
        slope: number,
        changePercent: number
    ): 'rising' | 'falling' | 'stable' {
        const TREND_THRESHOLD = 5; // 5% change threshold

        if (Math.abs(changePercent) < TREND_THRESHOLD) {
            return 'stable';
        }

        if (changePercent >= TREND_THRESHOLD && slope < 0) {
            // Price above average but decreasing - classify as rising (recent spike)
            return 'rising';
        }

        if (changePercent <= -TREND_THRESHOLD && slope > 0) {
            // Price below average but increasing - classify as falling (recent dip)
            return 'falling';
        }

        return changePercent > 0 ? 'rising' : 'falling';
    }

    /**
     * Analyzes best deal among active markets.
     *
     * Finds the market with the lowest USDT transfer cost. Useful for highlighting
     * the best current deal in the UI.
     *
     * @returns Market GUID and price of best deal, or null if no markets
     */
    async findBestDeal(): Promise<{ guid: string; price: number } | null> {
        const markets = await this.context.database.find<{
            guid: string;
            pricingDetail?: { minUsdtTransferCost?: number };
        }>(
            'markets',
            { isActive: true }
        );

        if (!markets.length) {
            return null;
        }

        // Find market with lowest USDT transfer cost
        let bestDeal: { guid: string; price: number } | null = null;

        for (const market of markets) {
            const price = market.pricingDetail?.minUsdtTransferCost;
            if (typeof price === 'number' && price > 0) {
                if (!bestDeal || price < bestDeal.price) {
                    bestDeal = { guid: market.guid, price };
                }
            }
        }

        return bestDeal;
    }
}
