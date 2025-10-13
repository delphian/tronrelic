import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { env } from '../../config/env.js';

class MarketMetricsService {
  private readonly enabled = env.ENABLE_TELEMETRY;
  private readonly registry: Registry | null;
  private readonly fetchDuration: Histogram<string> | null;
  private readonly fetchSuccess: Counter<string> | null;
  private readonly fetchFailure: Counter<string> | null;
  private readonly fetchRetry: Counter<string> | null;
  private readonly availabilityGauge: Gauge<string> | null;
  private readonly reliabilityGauge: Gauge<string> | null;
  private readonly effectivePriceGauge: Gauge<string> | null;

  constructor() {
    if (!this.enabled) {
      this.registry = null;
      this.fetchDuration = null;
      this.fetchSuccess = null;
      this.fetchFailure = null;
      this.fetchRetry = null;
      this.availabilityGauge = null;
      this.reliabilityGauge = null;
      this.effectivePriceGauge = null;
      return;
    }

    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry, prefix: 'tronrelic_' });

    this.fetchDuration = new Histogram({
      name: 'tronrelic_market_fetch_duration_seconds',
      help: 'Duration of market fetcher executions in seconds',
      labelNames: ['market'],
      registers: [this.registry]
    });

    this.fetchSuccess = new Counter({
      name: 'tronrelic_market_fetch_success_total',
      help: 'Total successful market fetch executions',
      labelNames: ['market'],
      registers: [this.registry]
    });

    this.fetchFailure = new Counter({
      name: 'tronrelic_market_fetch_failure_total',
      help: 'Total failed market fetch executions',
      labelNames: ['market'],
      registers: [this.registry]
    });

    this.fetchRetry = new Counter({
      name: 'tronrelic_market_fetch_retry_total',
      help: 'Total retry attempts performed by market fetchers',
      labelNames: ['market', 'stage'],
      registers: [this.registry]
    });

    this.availabilityGauge = new Gauge({
      name: 'tronrelic_market_availability_percent',
      help: 'Latest recorded availability percentage per market',
      labelNames: ['market'],
      registers: [this.registry]
    });

    this.reliabilityGauge = new Gauge({
      name: 'tronrelic_market_reliability_score',
      help: 'Latest exponential reliability score per market',
      labelNames: ['market'],
      registers: [this.registry]
    });

    this.effectivePriceGauge = new Gauge({
      name: 'tronrelic_market_effective_price_trx',
      help: 'Latest computed effective price (TRX per 32k energy) per market',
      labelNames: ['market'],
      registers: [this.registry]
    });
  }

  observeDuration(market: string, seconds: number) {
    this.fetchDuration?.labels(market).observe(seconds);
  }

  incrementSuccess(market: string) {
    this.fetchSuccess?.labels(market).inc();
  }

  incrementFailure(market: string) {
    this.fetchFailure?.labels(market).inc();
  }

  incrementRetry(market: string, stage: string) {
    this.fetchRetry?.labels(market, stage).inc();
  }

  setAvailability(market: string, value?: number) {
    if (value === undefined) {
      return;
    }
    this.availabilityGauge?.labels(market).set(value);
  }

  setReliability(market: string, value?: number) {
    if (value === undefined) {
      return;
    }
    this.reliabilityGauge?.labels(market).set(value);
  }

  setEffectivePrice(market: string, value?: number) {
    if (value === undefined) {
      return;
    }
    this.effectivePriceGauge?.labels(market).set(value);
  }

  async collectMetrics() {
    if (!this.enabled || !this.registry) {
      return '# Telemetry disabled\n';
    }
    return this.registry.metrics();
  }
}

export const marketMetrics = new MarketMetricsService();
