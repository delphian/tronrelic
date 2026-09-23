/**
 * What happened when block sync asked for one block's transaction receipts.
 *
 * - `'complete'` — a receipt came back for every transaction.
 * - `'partial'` — some came back, fewer than the block's transactions.
 * - `'failed'` — the switch was on but nothing came back.
 * - `'disabled'` — the switch was off, so nothing was asked for.
 * - `'empty'` — the block had no transactions, so there was nothing to ask for.
 *
 * Only `'complete'` and `'empty'` blocks carry `receiptsFetched: true`, which is
 * what decides whether their token transfers come from event logs.
 */
export type PipelineReceiptOutcome = 'complete' | 'partial' | 'failed' | 'disabled' | 'empty';
