/**
 * Barrel export for whale-alerts shared types.
 *
 * Centralizes all plugin-specific type definitions so both backend and frontend
 * can import from a single source of truth without duplication or drift.
 */
export type { IWhaleAlertsConfig } from './IWhaleAlertsConfig.js';
export type { IWhaleTransaction } from './IWhaleTransaction.js';
export type { IWhaleHighlight } from './IWhaleHighlight.js';
export type { IWhaleTimeseriesPoint } from './IWhaleTimeseriesPoint.js';
