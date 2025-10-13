import { MarketReliabilityHistoryModel, TransactionMemoModel, TransactionModel } from '../../database/models/index.js';
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

  async getMarketHistory(guid: string, limit = 120) {
    if (!guid) {
      throw new ValidationError('Market GUID required');
    }

    return MarketReliabilityHistoryModel.find({ guid })
      .sort({ recordedAt: -1 })
      .limit(Math.min(limit, 500))
      .lean();
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
