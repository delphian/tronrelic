/**
 * @fileoverview Public surface of the frontend curation module — the admin API
 * client for the central curation queue, and the hook that loads what a
 * pending item changes. Consumers import from the module root.
 */

export * from './api/client';
export { useCurationChanges } from './hooks/useCurationChanges';
export type { ICurationChangesState } from './hooks/useCurationChanges';
