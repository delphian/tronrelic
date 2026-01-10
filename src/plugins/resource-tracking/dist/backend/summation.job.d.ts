import type { IPluginDatabase, ISystemLogService, IPluginWebSocketManager } from '@/types';
/**
 * Aggregate delegation transaction data into summation records using block-based windows.
 *
 * This job operates on fixed block ranges (default 300 blocks ≈ 5 minutes at 3-second blocks)
 * instead of time-based intervals. Block-based aggregation provides deterministic, verifiable
 * summaries that align with blockchain's natural progression unit.
 *
 * The job maintains a persistent cursor (lastProcessedBlock) and calculates the next block
 * range to process based on the configurable blocksPerInterval setting. Before processing,
 * it verifies that block N+1 exists to ensure all blocks in the target range are fully indexed
 * and no transactions are missing.
 *
 * When the job detects it's fallen behind (blockchain sync is ahead), it processes up to
 * 3 tranches per run to catch up faster while still maintaining verification for each tranche.
 *
 * Key benefits over time-based aggregation:
 * - Deterministic: Reprocessing blocks 1000-1299 always produces identical results
 * - Verifiable: Each summation declares exact block ranges for audit trails
 * - Replayable: Can backfill or reprocess historical block ranges accurately
 * - Resilient: Waits for blockchain sync instead of creating incomplete summations
 * - Catch-up capable: Processes multiple tranches when behind
 *
 * @param database - Plugin-scoped database service for reading transactions and writing summations
 * @param logger - Scoped logger for job execution tracking
 * @param websocket - Plugin WebSocket manager for emitting real-time events to subscribed clients
 */
export declare function runSummationJob(database: IPluginDatabase, logger: ISystemLogService, websocket: IPluginWebSocketManager): Promise<void>;
//# sourceMappingURL=summation.job.d.ts.map