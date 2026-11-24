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
 * The id is followed by one icon, the wrench from the shared `ChipToolsMenu`,
 * exactly as on the address chip. Its menu holds copying the id and opening it
 * on Tronscan, and nothing else: no tool page consumes a transaction id, so
 * there are no tool entries, and a transaction is a one-off event with nothing
 * to tag. The wrench is not optional, so every transaction id everywhere offers
 * the same two actions.
 *
 * Like the address chip it renders synchronously from its prop — no fetch, no
 * async — so the truncated id is in the server HTML and only the menu needs
 * hydration.
 */
'use client';

import { Tooltip } from '../Tooltip';
import { ChipToolsMenu } from '../ChipToolsMenu';
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
 * the same window would leave far too many ids looking alike in a list. Six
 * and six keeps the chip short enough for a table column while each end still
 * has over sixteen million possible values, so two ids in one list almost
 * never look alike.
 */
const HEAD_CHARS = 6;
const TAIL_CHARS = 6;

/**
 * Props for {@link TronTransactionId}. There is deliberately no switch for the
 * wrench or its entries: every transaction id offers the same actions
 * wherever it appears.
 */
export interface ITronTransactionIdProps {
    /** Full transaction id (64-character hex). The value copied and linked. */
    txId: string;
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
 * Render a transaction id as a compact, monospace chip followed by a single
 * wrench whose menu copies the id and opens it on Tronscan. See the file
 * overview for why this is the single canonical transaction-id renderer.
 *
 * @param props - {@link ITronTransactionIdProps}; only `txId` is required.
 * @returns The transaction id chip element.
 */
export function TronTransactionId({
    txId,
    className
}: ITronTransactionIdProps) {
    return (
        <span className={[styles.root, className].filter(Boolean).join(' ')}>
            <Tooltip content={txId}>
                <span className={styles.tx_id} data-testid="tron-transaction-id-display">
                    {truncateTxId(txId)}
                </span>
            </Tooltip>

            <ChipToolsMenu
                value={txId}
                triggerLabel="Transaction tools"
                copyLabel="Copy transaction id"
                copiedLabel="Transaction id copied"
                explorerHref={`${TRONSCAN_TX_URL}${txId}`}
                explorerLabel="View transaction on Tronscan"
            />
        </span>
    );
}
