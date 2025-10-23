import { MarketPriceHistoryModel, TransactionMemoModel, TransactionModel } from '../../database/models/index.js';
import { ValidationError } from '../../lib/errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface TimeseriesPoint {
  date: string;
  value: number;
  count?: number;
  max?: number;
}

export class DashboardService {


  async getDelegationTimeseries(days = 14) {
    const { start } = this.ensureRange(days);

    const rows = await TransactionModel.aggregate<{
      _id: string;
      delegated: number;
      undelegated: number;
      count: number;
    }>([
      {
        $match: {
          timestamp: { $gte: start },
          type: { $in: ['DelegateResourceContract', 'UnDelegateResourceContract'] }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          delegated: {
            $sum: {
              $cond: [{ $eq: ['$type', 'DelegateResourceContract'] }, { $ifNull: ['$amountTRX', 0] }, 0]
            }
          },
          undelegated: {
            $sum: {
              $cond: [{ $eq: ['$type', 'UnDelegateResourceContract'] }, { $ifNull: ['$amountTRX', 0] }, 0]
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return rows.map(row => ({
      date: row._id,
      delegated: Number(row.delegated.toFixed(2)),
      undelegated: Number(row.undelegated.toFixed(2)),
      count: row.count
    }));
  }

  async getStakingTimeseries(days = 14) {
    const { start } = this.ensureRange(days);

    const rows = await TransactionModel.aggregate<{
      _id: string;
      staked: number;
      unstaked: number;
      count: number;
    }>([
      {
        $match: {
          timestamp: { $gte: start },
          type: {
            $in: ['FreezeBalanceContract', 'FreezeBalanceV2Contract', 'UnfreezeBalanceContract']
          }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          staked: {
            $sum: {
              $cond: [
                { $in: ['$type', ['FreezeBalanceContract', 'FreezeBalanceV2Contract']] },
                { $ifNull: ['$amountTRX', 0] },
                0
              ]
            }
          },
          unstaked: {
            $sum: {
              $cond: [{ $eq: ['$type', 'UnfreezeBalanceContract'] }, { $ifNull: ['$amountTRX', 0] }, 0]
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return rows.map(row => ({
      date: row._id,
      staked: Number(row.staked.toFixed(2)),
      unstaked: Number(row.unstaked.toFixed(2)),
      count: row.count
    }));
  }

  /**
   * Retrieves market pricing history with optional time-bucket aggregation.
   *
   * When `bucketHours` is provided, aggregates raw data points (recorded every 10 minutes)
   * into time buckets of the specified size (e.g., 6 hours), computing the average
   * minUsdtTransferCost for each bucket. This reduces payload size from 4,320 records
   * to ~120 buckets for 30-day queries, while preserving trend accuracy.
   *
   * Without `bucketHours`, returns raw data points up to the specified limit.
   *
   * @param guid - Market identifier to query
   * @param limit - Maximum number of raw records to retrieve (capped at 5,000)
   * @param bucketHours - Optional aggregation bucket size in hours (1-24)
   * @returns Array of market history records (raw or aggregated)
   */
  async getMarketHistory(guid: string, limit = 120, bucketHours?: number) {
    if (!guid) {
      throw new ValidationError('Market GUID required');
    }

    const rawHistory = await MarketPriceHistoryModel.find({ guid })
      .sort({ recordedAt: -1 })
      .limit(Math.min(limit, 5000))
      .lean();

    // If no bucketing requested, return raw data
    if (!bucketHours) {
      return rawHistory;
    }

    // Aggregate into time buckets
    const bucketSizeMs = bucketHours * 60 * 60 * 1000;
    const buckets = new Map<number, typeof rawHistory>();

    rawHistory.forEach(point => {
      const timestamp = new Date(point.recordedAt).getTime();
      const bucketKey = Math.floor(timestamp / bucketSizeMs) * bucketSizeMs;

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(point);
    });

    // Calculate aggregated values for each bucket
    const aggregated = Array.from(buckets.entries())
      .map(([bucketTimestamp, points]) => {
        // Filter out invalid minUsdtTransferCost values
        const validCosts = points
          .map(p => p.minUsdtTransferCost)
          .filter((cost): cost is number => typeof cost === 'number' && cost > 0);

        const avgCost = validCosts.length > 0
          ? validCosts.reduce((sum, cost) => sum + cost, 0) / validCosts.length
          : undefined;

        return {
          recordedAt: new Date(bucketTimestamp).toISOString(),
          minUsdtTransferCost: avgCost,
          // Include sample size for transparency
          sampleSize: points.length
        };
      })
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

    return aggregated;
  }

  async getMemoFeed(limit = 50) {
    return TransactionMemoModel.find()
      .sort({ timestamp: -1 })
      .limit(Math.min(limit, 200))
      .lean();
  }

  private ensureRange(days: number) {
    if (!Number.isFinite(days) || days <= 0) {
      throw new ValidationError('Days must be a positive number');
    }
    const clamped = Math.min(days, 90);
    const end = new Date();
    const start = new Date(Date.now() - clamped * DAY_MS);
    return { start, end };
  }
}
