/**
 * How a pipeline figure should read to an operator.
 *
 * The backend decides the tone and sends it with the figure, so the console
 * and any script reading `GET /api/admin/system/blockchain/pipeline` judge a
 * lag or a coverage percentage by the same thresholds instead of each keeping
 * its own copy. `'neutral'` means the figure carries no judgement, for example
 * before any block has been seen.
 */
export type PipelineTone = 'success' | 'warning' | 'danger' | 'neutral';
