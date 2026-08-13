/**
 * @fileoverview Canonical TRON transaction id chip.
 *
 * Every surface that shows a transaction id — core pages, admin tables, plugin
 * UIs injected through `context.ui.TronTransactionId` — should render it
 * through this one component, for the same reason `TronAddress` exists for
 * wallets: before it, each caller hand-rolled its own Tronscan anchor, and the
 * result drifted. A dozen call sites across core and the plugins each declared
 * their own copy of the explorer URL root and their own link styling, with
 * out-arrow icons at four different sizes, one anchor missing `noopener`, two
 * missing an `aria-label`, and nowhere to copy the id from.
 *
 * It also fixes a second problem the address chip never had. Almost every
 * existing transaction link renders *no id at all* — just an out-arrow icon —
 * so the reader cannot tell which transaction the row points at, cannot match
 * it against an explorer tab they already have open, and cannot copy it
 * without visiting Tronscan first. Showing a truncated id is the point of this
 * chip, not a decoration on the link.
 *
 * Deliberately narrower than `TronAddress` in two ways. There is no tools
 * menu: forwarding exists because public tool pages consume an address, and no
 * tool page consumes a transaction id, so a menu here would only ever offer
 * dead ends. There are no tags: address tags name a wallet an operator meets
 * repeatedly, while a transaction is a one-off event with nothing to name.
 *
 * Like the address chip it renders synchronously from its prop — no fetch, no
 * async — so the truncated id is in the server HTML and only the copy and
 * explorer affordances need hydration. It is a `'use client'` module because
 * both affordances it composes are client components.
 */
'use client';

import { ExternalLink } from 'lucide-react';
import { TrCopyIcon } from '../TrCopyIcon';
import { Tooltip } from '../Tooltip';
import styles from './TronTransactionId.module.scss';

/**
 * Explorer deep-link root for a transaction page. Tronscan is hardcoded for
 * the same reason `TronAddress` hardcodes its address root: the codebase has
 * no configurable explorer provider today, and every existing transaction link
 * points here. Centralizing it means a future switch changes one line rather
 * than every caller.
 */
const TRONSCAN_TX_URL = 'https://tronscan.org/#/transaction/';

/**
 * Characters kept from each end when truncating.
 *
 * Wider than the address chip's four-and-four on purpose. An address is 34
 * base58 characters opening with a fixed `T`, so four leading characters carry
 * three of entropy and still read as an address; a transaction id is 64 hex
 * characters with no prefix and only sixteen possible values per character, so
 * the same window would leave far too many ids looking alike in a list. Eight
 * and eight stays compact while keeping each end independently recognisable.
 */
const HEAD_CHARS = 8;
const TAIL_CHARS = 8;

/**
 * Props for {@link TronTransactionId}.
 */
export interface ITronTransactionIdProps {
    /** Full transaction id (64-character hex). The value copied and linked. */
    txId: string;
    /** Show the copy-to-clipboard affordance. @default true */
    copy?: boolean;
    /** Show the external Tronscan link. @default true */
    explorer?: boolean;
    /** Extra class on the root wrapper for spacing in a host layout. */
    className?: string;
}

/**
 * Shorten a transaction id to `head…tail`, why: a full 64-character hash set
 * inline swamps the row it sits in and pushes the surrounding data off the
 * screen, while the two ends are what a reader actually compares against an
 * explorer tab. Short inputs pass through untouched so we never render a `…`
 * that hides nothing.
 *
 * @param txId - Full transaction id to shorten; supplied by the caller's data
 *        row.
 * @returns The truncated display string, or the input unchanged when it is
 *          already at or below the combined head+tail length.
 */
function truncateTxId(txId: string): string {
    let result = txId;
    if (txId.length > HEAD_CHARS + TAIL_CHARS + 1) {
        result = `${txId.slice(0, HEAD_CHARS)}…${txId.slice(-TAIL_CHARS)}`;
    }
    return result;
}

/**
 * Render a transaction id as a compact, monospace chip with copy and explorer
 * affordances. See the file overview for why this is the single canonical
 * transaction-id renderer.
 *
 * @param props - {@link ITronTransactionIdProps}; `txId` is required and both
 *        affordance booleans default on, so the common case needs only the id
 *        and callers trim affordances off for dense read-only contexts.
 * @returns The transaction id chip element.
 */
export function TronTransactionId({
    txId,
    copy = true,
    explorer = true,
    className
}: ITronTransactionIdProps) {
    return (
        <span className={[styles.root, className].filter(Boolean).join(' ')}>
            <Tooltip content={txId}>
                <span className={styles.tx_id} data-testid="tron-transaction-id-display">
                    {truncateTxId(txId)}
                </span>
            </Tooltip>

            {copy && (
                // Icon-only, matching the out-link beside it — the same
                // reasoning as the address chip, where a bordered button made
                // copy read as the chip's primary action rather than one of
                // its equal affordances.
                <TrCopyIcon
                    value={txId}
                    size="xs"
                    aria-label="Copy transaction id"
                    copiedLabel="Transaction id copied"
                    className={styles.action}
                />
            )}

            {explorer && (
                <a
                    className={styles.action_link}
                    href={`${TRONSCAN_TX_URL}${txId}`}
                    target="_blank"
                    // Mandatory with `_blank`: without it the opened page gets
                    // a live `window.opener` handle back into this one.
                    rel="noopener noreferrer"
                    aria-label="View transaction on Tronscan"
                    // Stop the click bubbling to an enclosing clickable row,
                    // which would navigate away before the new tab opens. The
                    // default is not prevented, so the link still follows.
                    onClick={event => event.stopPropagation()}
                >
                    <ExternalLink size={14} />
                </a>
            )}
        </span>
    );
}
