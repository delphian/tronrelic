/**
 * Which rule the block buffer used for its most recent release.
 *
 * The buffer releases at different speeds depending on how deep it is, and the
 * speed it chose says more about its health than the depth alone:
 *
 * - `'seeding'` — building its initial lead after a restart; nothing released yet.
 * - `'idle'` — nothing has been released yet since the buffer seeded.
 * - `'refill'` — below target, releasing slower than the chain to grow the lead back.
 * - `'steady'` — at target, releasing at the chain's own cadence.
 * - `'drain'` — just above target, releasing slightly faster to give the surplus back.
 * - `'catch-up'` — well above target after a burst, releasing fast.
 * - `'burst'` — past the maximum depth, releasing with no wait at all.
 */
export type PipelineReleaseMode = 'seeding' | 'idle' | 'refill' | 'steady' | 'drain' | 'catch-up' | 'burst';
