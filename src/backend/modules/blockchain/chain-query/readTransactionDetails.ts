/**
 * @fileoverview Read one page of transactions' signer details from `tron.transaction`.
 *
 * Several chain query tools list transactions found in another table, such as
 * the delegation tables, or found by a scan that should stay narrow. The
 * signatures and the contract parameter are the widest columns in
 * `tron.transaction`, so those tools read them only for the rows they are
 * about to return, through this one point read.
 *
 * The read is shaped for ClickHouse's sort key, `(block_number,
 * transaction_index)`. `block_number IN` lets the primary index open one
 * granule per block, the `tx_id` list runs in PREWHERE so the wide columns are
 * read only for matching rows, and the page's own time range lets ClickHouse
 * skip every other daily partition. A page of 200 rows therefore reads at most
 * 200 granules however far apart they are. Looking the rows up by `tx_id` alone
 * would not do this: its bloom filter covers about 32,000 rows per index
 * block, so 200 scattered ids pass most of the table through.
 *
 * Signer recovery runs here too, because it is what the signatures are read
 * for. It costs about 1.4 ms per signature on the backend's event loop, so
 * the loop yields between small batches and a 200-row page cannot hold up
 * block sync or WebSocket traffic for its whole duration.
 *
 * @module backend/modules/blockchain/chain-query/readTransactionDetails
 */

import { recoverTransactionSigners } from '../../../lib/recoverTransactionSigners.js';
import { CHAIN_DATA_DATABASE } from '../chain-data/buildChainDataSchema.js';
import type { ChainQuerySession } from './ChainQuerySession.js';

/** Signatures recovered between two yields to the event loop. */
const RECOVERIES_PER_YIELD = 20;

/** Where one listed transaction sits, as the listing query returned it. */
export interface ITransactionRef {
    /** The block the transaction is in, which leads the table's sort key. */
    block: number;
    /** The block time as ClickHouse returned it, which bounds the partitions read. */
    time: string;
    /** The transaction id, which picks the row out of its block. */
    txId: string;
}

/** What the point read found for one transaction. */
export interface ITransactionDetails {
    /** How many signatures the transaction carries. */
    signatureCount: number;
    /**
     * The distinct keys recovered from the signatures, in signature order.
     * Null when recovery was not asked for, or when no signature is stored for
     * the transaction, so the answer is unknown rather than "nobody".
     */
    signers: string[] | null;
    /** The contract parameter's `owner_address` in hex, when asked for. */
    ownerHex: string | null;
}

/** Which of the wide columns the caller needs. */
export interface ITransactionDetailOptions {
    /** Read the signatures and recover who signed. */
    recover: boolean;
    /** Read the contract parameter's `owner_address`. */
    owner: boolean;
}

/** One row of the point read. */
interface IDetailRow {
    tx_id: string;
    signature_count: string | number;
    signature?: string[];
    owner_hex?: string;
}

/**
 * Read signer details for one page of transactions.
 *
 * @param session - The call's session, so the read is charged to the run's quota and deadline.
 * @param refs - The page's transactions, each with the block and time the listing query returned, which are what keep the read narrow.
 * @param options - Which wide columns to read; leaving one out keeps it off the bytes read.
 * @returns Details by transaction id; a transaction the read did not find is absent.
 */
export async function readTransactionDetails(
    session: ChainQuerySession,
    refs: readonly ITransactionRef[],
    options: ITransactionDetailOptions
): Promise<Map<string, ITransactionDetails>> {
    const details = new Map<string, ITransactionDetails>();
    if (refs.length > 0) {
        const times = refs.map(ref => ref.time).sort();
        const columns = [
            'tx_id',
            'signature.size0 AS signature_count',
            ...(options.recover ? ['signature'] : []),
            ...(options.owner ? ['JSONExtractString(parameter, \'owner_address\') AS owner_hex'] : [])
        ];
        const rows = await session.query<IDetailRow>(
            `SELECT ${columns.join(', ')}
FROM ${CHAIN_DATA_DATABASE}.transaction
PREWHERE tx_id IN {txIds:Array(String)}
WHERE block_number IN {blocks:Array(UInt64)}
  AND block_timestamp >= {first:DateTime64(3, 'UTC')} AND block_timestamp <= {last:DateTime64(3, 'UTC')}
LIMIT 1 BY tx_id`,
            {
                txIds: refs.map(ref => ref.txId),
                blocks: [...new Set(refs.map(ref => ref.block))],
                first: times[0],
                last: times[times.length - 1]
            }
        );
        let recovered = 0;
        for (const row of rows) {
            const signatures = Array.isArray(row.signature) ? row.signature : [];
            let signers: string[] | null = null;
            if (options.recover && signatures.length > 0) {
                signers = recoverTransactionSigners(row.tx_id, signatures);
                recovered += signatures.length;
                if (recovered >= RECOVERIES_PER_YIELD) {
                    recovered = 0;
                    await yieldToEventLoop();
                }
            }
            details.set(row.tx_id, {
                signatureCount: Number(row.signature_count),
                signers,
                ownerHex: options.owner ? row.owner_hex || null : null
            });
        }
    }
    return details;
}

/**
 * Let queued I/O run before the next batch of recoveries.
 *
 * Recovery is synchronous CPU work on the same event loop that commits
 * blocks and serves WebSockets, so a long page is broken into short slices.
 *
 * @returns A promise that settles on the next turn of the event loop.
 */
function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

/**
 * The notes a page with recovered signers needs, so every tool explains
 * missing or partial recoveries the same way.
 *
 * @param details - The page's details, as {@link readTransactionDetails} returned them.
 * @param expected - How many transactions the page listed, so rows the read did not find are reported.
 * @returns Zero or more notes.
 */
export function signerNotes(details: Map<string, ITransactionDetails>, expected: number): string[] {
    const values = [...details.values()];
    const notStored = values.filter(value => value.signatureCount === 0).length + Math.max(0, expected - details.size);
    const partial = values.filter(value => value.signers !== null && value.signers.length < value.signatureCount).length;
    return [
        ...(notStored > 0 ? [`${notStored} transaction${notStored === 1 ? ' has' : 's have'} no stored signatures, so signers is null there: unknown, not unsigned.`] : []),
        ...(partial > 0 ? [`${partial} transaction${partial === 1 ? ' has' : 's have'} fewer recovered signers than signatures; a signature that could not be recovered is left out rather than guessed.`] : [])
    ];
}
