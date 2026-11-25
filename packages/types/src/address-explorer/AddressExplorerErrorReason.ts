/**
 * @fileoverview Why one section of the address page could not be read.
 *
 * Each reason calls for a different message, so the backend names it instead
 * of sending free text: a read that was too large can be retried over a
 * shorter span, while a used-up hourly quota cannot be fixed by retrying now.
 */

/**
 * The cause of a failed address page section.
 *
 * - `too-large`: the wallet is too busy to read over the requested span.
 * - `quota`: the visitor used up their hourly allowance of chain reads.
 * - `busy`: too many address page reads were running at once.
 * - `unavailable`: chain data cannot be read on this deployment right now.
 * - `failed`: anything else; the details are in the server log.
 */
export type AddressExplorerErrorReason = 'too-large' | 'quota' | 'busy' | 'unavailable' | 'failed';
