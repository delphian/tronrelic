import { performance } from 'node:perf_hooks';

export interface MetricRecord {
  name: string;
  durationMs: number;
  success: boolean;
  tags?: Record<string, string>;
}

const subscribers: Array<(metric: MetricRecord) => void> = [];

export function emitMetric(metric: MetricRecord) {
  subscribers.forEach(handler => handler(metric));
}

export function onMetric(handler: (metric: MetricRecord) => void) {
  subscribers.push(handler);
}

export async function withTiming<T>(name: string, fn: () => Promise<T>, tags?: Record<string, string>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    emitMetric({ name, durationMs: performance.now() - start, success: true, tags });
    return result;
  } catch (error) {
    emitMetric({ name, durationMs: performance.now() - start, success: false, tags });
    throw error;
  }
}
