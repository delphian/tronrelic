/**
 * @fileoverview Tether blacklist delta source — asserts `usdt:frozen` on TRON
 * addresses the USDT contract has blacklisted, and withdraws it when the
 * blacklisting is lifted.
 *
 * This source polls rather than observes. A blacklist action arrives as a
 * `TriggerSmartContract` call on the highest-volume contract on TRON, so an
 * observer subscribed to that type would receive every USDT transfer and shed
 * load through `BaseObserver`'s bounded queue — dropping exactly the rare
 * event that mattered. TronGrid filters by `event_name` server-side, so a
 * scheduled poll retrieves only blacklist events, costs one request per
 * interval, and resumes from a stored cursor when a tick is missed.
 *
 * The cursor is the timestamp of the newest event consumed. Resume overlaps
 * one block rather than one millisecond, relying on `syncSource`'s idempotence
 * to absorb the repeat. Note the two-step multisig: a blacklist request is
 * submitted publicly before a second signer confirms and the event fires; this
 * source reads only the confirmed event.
 *
 * The weekly {@link UsdtBlacklistSource.verify} pass turns this event-delta
 * source into one that repairs its own drift: it re-checks every address
 * currently held as frozen against contract state (`isBlackListed`), refreshes
 * what the contract confirms, and withdraws what it denies.
 */

import { toBase58Address, toHexAddress } from '../../../lib/tron-address.js';
import type { IAddressTagAssertion } from '@/types';
import type { ITagSourceResult, IVerifiableTagSource } from './ITagSource.js';

/** The source id written into `sources[].id` on tagged documents. */
export const USDT_SOURCE_ID = 'usdt-blacklist';

/** The reserved tag this source asserts. */
export const USDT_TAG = 'usdt:frozen';

/** The TRON USDT contract whose blacklist events and state are read. */
export const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** Resume overlap: one TRON block (~3s), not one millisecond. */
const CURSOR_OVERLAP_MS = 3000;

/** Events per page and a page cap bounding one poll's work. */
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;

/** The transport surface this source needs — `TronGridClient` satisfies it. */
export interface IUsdtBlacklistTransport {
    /** Server-side-filtered contract event reads. */
    getContractEvents<T>(contractAddress: string, params: Record<string, string | number | boolean>): Promise<T>;
    /** Read-only contract state calls for the verify pass. */
    triggerConstantContract<T>(payload: Record<string, unknown>): Promise<T>;
}

/** One event row as the TronGrid v1 events feed returns it. */
interface ITronGridEventRow {
    block_timestamp?: number;
    transaction_id?: string;
    event_name?: string;
    result?: Record<string, unknown>;
}

/** One page of the events feed with its continuation fingerprint. */
interface ITronGridEventPage {
    data?: ITronGridEventRow[];
    meta?: { fingerprint?: string };
}

/** Shape of a `triggerconstantcontract` response, reduced to what verify reads. */
interface ITriggerConstantResult {
    result?: { result?: boolean; message?: string };
    constant_result?: string[];
}

/**
 * The Tether freeze-feed source (delta mode) plus the drift-repairing verify
 * pass the weekly job drives.
 */
export class UsdtBlacklistSource implements IVerifiableTagSource {
    public readonly id = USDT_SOURCE_ID;
    public readonly mode = 'delta' as const;
    public readonly publish = 'direct' as const;
    /** Every five minutes — the plan's 5–10 minute cadence, lower bound. */
    public readonly cron = '0 */5 * * * *';
    /** The tag whose live holdings the weekly verify pass re-checks. */
    public readonly verifiedTag = USDT_TAG;

    /**
     * @param transport - TronGrid access, injectable so tests feed recorded
     *                    event fixtures instead of hitting the network.
     */
    constructor(private readonly transport: IUsdtBlacklistTransport) {}

    /** @inheritdoc */
    public async fetch(cursor?: string): Promise<ITagSourceResult> {
        const since = this.parseCursor(cursor);
        const [added, removed] = await Promise.all([
            this.drainEvents('AddedBlackList', since),
            this.drainEvents('RemovedBlackList', since)
        ]);

        // The two streams drain independently, so when one hits its page cap
        // the other may have been consumed well past it. The cursor must not
        // advance beyond the newest event a capped stream actually consumed:
        // events past that point were never fetched, and a skipped
        // AddedBlackList is unrepairable — the weekly verify pass only
        // re-checks addresses already held as frozen. Events applied beyond
        // the ceiling this tick are safe: the next tick replays them, and the
        // reconcile is idempotent.
        let cursorCeiling = Number.POSITIVE_INFINITY;
        if (added.capped) {
            cursorCeiling = Math.min(cursorCeiling, this.newestTimestampOf(added.rows));
        }
        if (removed.capped) {
            cursorCeiling = Math.min(cursorCeiling, this.newestTimestampOf(removed.rows));
        }

        // The overlap window can replay an address's add and remove together,
        // so only each address's chronologically last event decides its final
        // state — applying both in feed order would let a same-window
        // re-listing end withdrawn.
        const lastEventByAddress = new Map<string, { frozen: boolean; row: ITronGridEventRow }>();
        const ordered = [...added.rows.map((row) => ({ frozen: true, row })), ...removed.rows.map((row) => ({ frozen: false, row }))]
            .sort((a, b) => (a.row.block_timestamp ?? 0) - (b.row.block_timestamp ?? 0));
        for (const event of ordered) {
            const address = this.eventAddress(event.row);
            if (!address) {
                continue;
            }
            lastEventByAddress.set(address, event);
        }

        // Newest consumed across both streams, capped as above. Counted over
        // every row rather than only rows with a readable address, because an
        // unreadable row still marks its window as covered — skipping it
        // would pin the cursor on that window indefinitely.
        const newestTimestamp = Math.min(
            Math.max(this.newestTimestampOf(added.rows), this.newestTimestampOf(removed.rows)),
            cursorCeiling
        );

        const assertions: IAddressTagAssertion[] = [];
        const withdrawn: IAddressTagAssertion[] = [];
        for (const [address, event] of lastEventByAddress) {
            const assertion: IAddressTagAssertion = { address, tag: USDT_TAG };
            if (event.row.transaction_id) {
                assertion.ref = event.row.transaction_id;
                assertion.url = `https://tronscan.org/#/transaction/${event.row.transaction_id}`;
            }
            (event.frozen ? assertions : withdrawn).push(assertion);
        }

        return {
            assertions,
            withdrawn,
            // Advance only when events arrived; a quiet window keeps the old
            // position so the next tick re-covers it.
            cursor: newestTimestamp > 0 ? String(newestTimestamp) : cursor
        };
    }

    /**
     * Re-verify held freezes against contract state. An address the contract
     * confirms is refreshed; one it denies is withdrawn; one whose call fails
     * is left exactly as it was, because a transport error is not evidence of
     * delisting.
     *
     * @param addresses - The addresses currently held live under `usdt:frozen`.
     * @returns Confirmations as assertions and denials as withdrawals, ready
     *          for a delta `syncSource` pass.
     */
    public async verify(addresses: string[]): Promise<ITagSourceResult> {
        const assertions: IAddressTagAssertion[] = [];
        const withdrawn: IAddressTagAssertion[] = [];
        for (const address of addresses) {
            const frozen = await this.isBlacklisted(address);
            if (frozen === null) {
                continue;
            }
            (frozen ? assertions : withdrawn).push({ address, tag: USDT_TAG });
        }
        return { assertions, withdrawn };
    }

    /**
     * Ask the contract whether one address is currently blacklisted.
     *
     * @param address - Base58 address to check.
     * @returns True/false from contract state, or null when the call failed
     *          and no conclusion may be drawn.
     */
    private async isBlacklisted(address: string): Promise<boolean | null> {
        try {
            const response = await this.transport.triggerConstantContract<ITriggerConstantResult>({
                owner_address: USDT_CONTRACT,
                contract_address: USDT_CONTRACT,
                function_selector: 'isBlackListed(address)',
                parameter: this.encodeAddressParameter(address),
                visible: true
            });
            const word = response.constant_result?.[0];
            if (response.result?.result !== true || !word) {
                return null;
            }
            return BigInt(`0x${word}`) !== 0n;
        } catch {
            return null;
        }
    }

    /**
     * ABI-encode one address argument: the 20 account bytes (the 41 prefix
     * stripped) left-padded to a 32-byte word.
     *
     * @param address - Base58 address to encode.
     * @returns The 64-character hex parameter string.
     */
    private encodeAddressParameter(address: string): string {
        return toHexAddress(address).slice(2).toLowerCase().padStart(64, '0');
    }

    /**
     * Drain one event stream from the resume position, following the
     * fingerprint pagination to a bounded page count so a very stale cursor
     * cannot pin a tick indefinitely. A stream that stops at the cap reports
     * `capped: true`, because the caller must then hold the cursor back to
     * this stream's newest consumed event — advancing past it would skip the
     * unread remainder forever.
     *
     * @param eventName - `AddedBlackList` or `RemovedBlackList`.
     * @param since - Minimum block timestamp, already overlap-adjusted.
     * @returns The rows retrieved this pass, and whether the page cap cut the
     *          stream off with more data still available.
     */
    private async drainEvents(eventName: string, since: number): Promise<{ rows: ITronGridEventRow[]; capped: boolean }> {
        const rows: ITronGridEventRow[] = [];
        let fingerprint: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
            const params: Record<string, string | number | boolean> = {
                event_name: eventName,
                min_block_timestamp: since,
                order_by: 'block_timestamp,asc',
                limit: PAGE_LIMIT
            };
            if (fingerprint) {
                params.fingerprint = fingerprint;
            }
            const response = await this.transport.getContractEvents<ITronGridEventPage>(USDT_CONTRACT, params);
            rows.push(...(response.data ?? []));
            fingerprint = response.meta?.fingerprint;
            if (!fingerprint || (response.data ?? []).length === 0) {
                return { rows, capped: false };
            }
        }
        return { rows, capped: true };
    }

    /**
     * Newest block timestamp among the given rows, or 0 when there are none.
     * Used both for cursor advancement and for the capped-stream ceiling, so
     * the two always measure "consumed up to" the same way.
     *
     * @param rows - Event rows from one drained stream.
     * @returns The maximum `block_timestamp`, or 0 for an empty stream.
     */
    private newestTimestampOf(rows: ITronGridEventRow[]): number {
        let newest = 0;
        for (const row of rows) {
            newest = Math.max(newest, row.block_timestamp ?? 0);
        }
        return newest;
    }

    /**
     * Extract and normalize the event's address argument. TronGrid names ABI
     * arguments (`_user`) but also indexes them positionally, and delivers the
     * value as EVM-style hex — convert to base58 so it matches the service's
     * validation.
     *
     * @param row - The raw event row.
     * @returns The base58 address, or null when the row carries none readable.
     */
    private eventAddress(row: ITronGridEventRow): string | null {
        const raw = row.result?._user ?? row.result?.['0'];
        if (typeof raw !== 'string' || raw.length === 0) {
            return null;
        }
        try {
            return toBase58Address(raw);
        } catch {
            return null;
        }
    }

    /**
     * Parse the stored cursor back to an overlap-adjusted resume timestamp. A
     * missing or malformed cursor restarts from the beginning of the feed,
     * which is safe (idempotent reconcile) if slow.
     *
     * @param cursor - The stored cursor, if any.
     * @returns The `min_block_timestamp` to resume from.
     */
    private parseCursor(cursor?: string): number {
        const value = Number(cursor);
        if (!Number.isFinite(value) || value <= 0) {
            return 0;
        }
        return Math.max(0, value - CURSOR_OVERLAP_MS);
    }
}
