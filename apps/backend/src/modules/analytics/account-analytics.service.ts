import type { Redis as RedisClient } from 'ioredis';
import { TransactionModel } from '../../database/models/transaction-model.js';
import { CacheService } from '../../services/cache.service.js';
import { ValidationError } from '../../lib/errors.js';

export interface AccountTransactionRecord {
  type: string;
  time: number;
  id: string;
  from?: string;
  to?: string;
  amount?: number;
  resource?: string;
  lock?: boolean;
  lockPeriod?: number;
  pool?: string | null;
}

export interface AccountTransactionEntry {
  type: string;
  record: AccountTransactionRecord;
}

export interface AccountTransactionsResult {
  success: boolean;
  transactions: AccountTransactionEntry[];
  approximate?: boolean;
  monteCarloSummary?: MonteCarloSummary;
}

const MAX_RANGE_RESULTS = 1000;
const CACHE_TTL_SECONDS = 300;
const MONTE_CARLO_SAMPLE_SIZE = 750;

export interface MonteCarloCounterpartyEstimate {
  address: string;
  direction: 'inflow' | 'outflow';
  estimatedAmountTRX: number;
  estimatedCount: number;
}

export interface MonteCarloSummary {
  populationSize: number;
  sampleSize: number;
  scalingFactor: number;
  estimatedIncomingTrx: number;
  estimatedOutgoingTrx: number;
  netFlowTrx: number;
  estimatedIncomingCount: number;
  estimatedOutgoingCount: number;
  topCounterparties: MonteCarloCounterpartyEstimate[];
}

interface TransactionLean {
  txId: string;
  timestamp: Date;
  type: string;
  from: { address: string };
  to: { address: string };
  amount?: number;
  amountTRX?: number;
  contract?: {
    parameters?: Record<string, unknown>;
  };
}

export class AccountAnalyticsService {
  private readonly cache: CacheService;

  constructor(redis: RedisClient) {
    this.cache = new CacheService(redis);
  }

  async getRecentTransactions(address: string, limit: number, ignoreTrx: number): Promise<AccountTransactionsResult> {
    this.assertAddress(address);
    this.assertLimit(limit, 1000);

    const ignoreSun = this.toSun(ignoreTrx);
    const match = {
      $and: [
        { $or: [{ 'from.address': address }, { 'to.address': address }] },
        this.buildIgnoreClause(ignoreSun)
      ]
    };

    const documents = (await TransactionModel.find(match)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()) as TransactionLean[];

    const transactions = documents.map(doc => this.toEntry(doc, address));

    return { success: true, transactions };
  }

  async getTransactionsByDateRange(
    address: string,
    startDateMs: number,
    endDateMs: number,
    ignoreTrx: number
  ): Promise<AccountTransactionsResult> {
    this.assertAddress(address);
    const { start, end } = this.normalizeRange(startDateMs, endDateMs);

    const ignoreSun = this.toSun(ignoreTrx);
    const cacheKey = `analytics:account:${address}:range:${start.getTime()}:${end.getTime()}:${ignoreSun}`;

    const cached = await this.cache.get<AccountTransactionsResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const match = {
      $and: [
        { $or: [{ 'from.address': address }, { 'to.address': address }] },
        { timestamp: { $gte: start, $lte: end } },
        this.buildIgnoreClause(ignoreSun)
      ]
    };

    const total = await TransactionModel.countDocuments(match);

    let result: AccountTransactionsResult;

    if (total > MAX_RANGE_RESULTS) {
      result = await this.runMonteCarloAggregation(match, address, total);
    } else {
      const documents = (await TransactionModel.find(match)
        .sort({ timestamp: -1 })
        .limit(MAX_RANGE_RESULTS)
        .lean()) as TransactionLean[];

      const transactions = documents.map(doc => this.toEntry(this.normalizeDocument(doc), address));
      result = { success: true, transactions };
    }

    await this.cache.set(cacheKey, result, CACHE_TTL_SECONDS, ['account-range']);

    return result;
  }

  private async runMonteCarloAggregation(
    match: Record<string, unknown>,
    address: string,
    populationSize: number
  ): Promise<AccountTransactionsResult> {
    const requestedSample = Math.min(populationSize, MONTE_CARLO_SAMPLE_SIZE);
    const sampleSize = Math.max(Math.floor(requestedSample), 1);
    const sampleDocuments = (await TransactionModel.aggregate<TransactionLean>([
      { $match: match },
      { $sample: { size: sampleSize } }
    ])) as TransactionLean[];

    if (sampleDocuments.length === 0) {
      return {
        success: true,
        transactions: [],
        approximate: true,
        monteCarloSummary: {
          populationSize,
          sampleSize: 0,
          scalingFactor: 0,
          estimatedIncomingTrx: 0,
          estimatedOutgoingTrx: 0,
          netFlowTrx: 0,
          estimatedIncomingCount: 0,
          estimatedOutgoingCount: 0,
          topCounterparties: []
        }
      };
    }

    const normalized = sampleDocuments.map(doc => this.normalizeDocument(doc));
    normalized.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const transactions = normalized.map(doc => this.toEntry(doc, address));
    const summary = this.buildMonteCarloSummary(normalized, address, populationSize);

    return {
      success: true,
      transactions,
      approximate: true,
      monteCarloSummary: summary
    };
  }

  private buildMonteCarloSummary(documents: TransactionLean[], address: string, populationSize: number): MonteCarloSummary {
    let incomingAmountSample = 0;
    let outgoingAmountSample = 0;
    let incomingCountSample = 0;
    let outgoingCountSample = 0;

    const counterparties = new Map<string, { address: string; direction: 'inflow' | 'outflow'; amount: number; count: number }>();

    for (const doc of documents) {
      const amountTrx = this.resolveAmountTrx(doc) ?? 0;
      const isIncoming = doc.to?.address === address;
      const counterparty = isIncoming ? doc.from?.address : doc.to?.address;

      if (!counterparty) {
        continue;
      }

      if (isIncoming) {
        incomingAmountSample += amountTrx;
        incomingCountSample += 1;
      } else {
        outgoingAmountSample += amountTrx;
        outgoingCountSample += 1;
      }

      const key = `${isIncoming ? 'in' : 'out'}:${counterparty}`;
      const current = counterparties.get(key) ?? {
        address: counterparty,
        direction: isIncoming ? 'inflow' as const : 'outflow' as const,
        amount: 0,
        count: 0
      };

      current.amount += amountTrx;
      current.count += 1;
      counterparties.set(key, current);
    }

    const sampleSize = documents.length;
    const scalingFactor = sampleSize === 0 ? 0 : populationSize / sampleSize;

    const estimatedIncomingTrx = Number((incomingAmountSample * scalingFactor).toFixed(2));
    const estimatedOutgoingTrx = Number((outgoingAmountSample * scalingFactor).toFixed(2));
    const estimatedIncomingCount = Math.round(incomingCountSample * scalingFactor);
    const estimatedOutgoingCount = Math.round(outgoingCountSample * scalingFactor);

    const topCounterparties = Array.from(counterparties.values())
      .map(counterparty => ({
        address: counterparty.address,
        direction: counterparty.direction,
        estimatedAmountTRX: Number((counterparty.amount * scalingFactor).toFixed(2)),
        estimatedCount: Math.max(1, Math.round(counterparty.count * scalingFactor))
      }))
      .sort((a, b) => b.estimatedAmountTRX - a.estimatedAmountTRX)
      .slice(0, 10);

    return {
      populationSize,
      sampleSize,
      scalingFactor: Number(scalingFactor.toFixed(4)),
      estimatedIncomingTrx,
      estimatedOutgoingTrx,
      netFlowTrx: Number((estimatedIncomingTrx - estimatedOutgoingTrx).toFixed(2)),
      estimatedIncomingCount,
      estimatedOutgoingCount,
      topCounterparties
    };
  }

  private normalizeDocument(doc: TransactionLean): TransactionLean {
    return {
      ...doc,
      timestamp: doc.timestamp instanceof Date ? doc.timestamp : new Date(doc.timestamp)
    };
  }

  private resolveAmountTrx(doc: TransactionLean): number | null {
    if (typeof doc.amountTRX === 'number') {
      return doc.amountTRX;
    }
    if (typeof doc.amount === 'number') {
      return doc.amount / 1_000_000;
    }
    return null;
  }

  private buildIgnoreClause(ignoreSun: number) {
    if (!ignoreSun) {
      return {};
    }
    return {
      $or: [
        { type: { $ne: 'TransferContract' } },
        { type: 'TransferContract', amount: { $gt: ignoreSun } }
      ]
    };
  }

  private toEntry(doc: TransactionLean, address: string): AccountTransactionEntry {
    switch (doc.type) {
      case 'DelegateResourceContract':
        return { type: doc.type, record: this.toDelegateRecord(doc) };
      case 'UnDelegateResourceContract':
        return { type: doc.type, record: this.toUnDelegateRecord(doc) };
      default:
        return { type: doc.type, record: this.toTransferRecord(doc, address) };
    }
  }

  private toDelegateRecord(doc: TransactionLean): AccountTransactionRecord {
    const params = (doc.contract?.parameters ?? {}) as Record<string, unknown>;
    return {
      type: doc.type,
      time: doc.timestamp.getTime(),
      id: doc.txId,
      from: doc.from.address,
      to: doc.to.address,
      amount: doc.amountTRX ?? 0,
      resource: typeof params.resource === 'string' ? params.resource : 'BANDWIDTH',
      lock: Boolean(params.lock ?? params.is_locked ?? false),
      lockPeriod: this.resolveLockPeriod(params),
      pool: this.resolvePool(params)
    };
  }

  private toUnDelegateRecord(doc: TransactionLean): AccountTransactionRecord {
    const params = (doc.contract?.parameters ?? {}) as Record<string, unknown>;
    return {
      type: doc.type,
      time: doc.timestamp.getTime(),
      id: doc.txId,
      from: doc.from.address,
      to: doc.to.address,
      amount: doc.amountTRX ?? 0,
      resource: typeof params.resource === 'string' ? params.resource : 'BANDWIDTH'
    };
  }

  private toTransferRecord(doc: TransactionLean, address: string): AccountTransactionRecord {
    return {
      type: doc.type,
      time: doc.timestamp.getTime(),
      id: doc.txId,
      from: doc.from.address,
      to: doc.to.address,
      amount:
        doc.amountTRX ?? (typeof doc.amount === 'number' ? doc.amount / 1_000_000 : undefined),
      pool: null,
      lock: undefined,
      lockPeriod: undefined
    };
  }

  private resolveLockPeriod(params: Record<string, unknown>): number {
    if (typeof params.lock_period === 'number') {
      return params.lock_period;
    }
    if (typeof params.lockPeriod === 'number') {
      return params.lockPeriod;
    }
    return 0;
  }

  private resolvePool(params: Record<string, unknown>): string | null {
    if (typeof params.pool === 'string' && params.pool.length) {
      return params.pool;
    }
    if (typeof params.multisig === 'string' && params.multisig.length) {
      return params.multisig;
    }
    return null;
  }

  private normalizeRange(startMs: number, endMs: number) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new ValidationError('Invalid date range supplied');
    }

    const start = new Date(Math.min(startMs, endMs));
    const end = new Date(Math.max(startMs, endMs));

    if (start.getTime() === end.getTime()) {
      end.setMilliseconds(end.getMilliseconds() + 1);
    }

    return { start, end };
  }

  private assertAddress(address: string) {
    if (!address || typeof address !== 'string' || address.length < 34 || address.length > 64) {
      throw new ValidationError('Invalid Tron address supplied');
    }
    if (!address.startsWith('T')) {
      throw new ValidationError('Address must be a base58 Tron wallet address');
    }
  }

  private assertLimit(limit: number, max: number) {
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new ValidationError('Limit must be a positive integer');
    }
    if (limit > max) {
      throw new ValidationError(`Limit exceeds maximum of ${max}`);
    }
  }

  private toSun(amountTrx: number) {
    if (!amountTrx || !Number.isFinite(amountTrx)) {
      return 0;
    }
    return Math.floor(amountTrx * 1_000_000);
  }
}
