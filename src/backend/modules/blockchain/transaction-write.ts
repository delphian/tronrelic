/**
 * @fileoverview Which of a transaction's fields block sync writes to MongoDB.
 *
 * Observers and the database receive the same payload object, but not every
 * field on it belongs in the `transactions` collection. `transactionIndex` is
 * the clearest case: observers need it to order a block's transactions, and no
 * stored read uses it, so writing it would add bytes to every document in the
 * largest collection for nothing.
 *
 * The schema does not drop an undeclared field on this write path, so leaving
 * the field out has to be done here, explicitly. It lives as a pure function,
 * alongside `chain-head.ts` and `sync-mode.ts`, so a test pins what reaches the
 * database without driving the whole commit.
 *
 * @module backend/modules/blockchain/transaction-write
 */
import type { ITransactionPersistencePayload } from '@/types';

/**
 * Build the `$set` fields for one transaction's upsert.
 *
 * Every write of a transaction document goes through this function, so a field
 * delivered to observers only is left out in one place rather than at each
 * call site.
 *
 * `tokenTransfer` is left out for the same reason as `transactionIndex`: it is
 * decoded from the call data, which `contract.parameters.rawData` already
 * stores, so writing it would duplicate bytes on every TRC20 transfer.
 *
 * `events`, `tokenTransfers`, and `internalTransfers` are left out because of
 * their volume. A busy block carries hundreds of event logs, and MongoDB is the
 * wrong store for data at that scale. If a consumer ever needs event history,
 * it belongs in a dedicated ClickHouse table keyed on the event identity, not
 * on every transaction document. The raw internal transactions are still
 * stored as `internalTransactions`.
 *
 * @param payload - The transaction as block sync prepared it, including the
 *                  fields only observers read.
 * @returns The same fields minus the observer-only ones, ready to spread into
 *          `$set`.
 */
export function toTransactionWriteFields(
    payload: ITransactionPersistencePayload
): Omit<ITransactionPersistencePayload, ObserverOnlyField> {
    const {
        transactionIndex: _observerOnly,
        tokenTransfer: _decodedOnly,
        events: _eventsOnly,
        tokenTransfers: _transfersOnly,
        internalTransfers: _internalOnly,
        ...fields
    } = payload;
    return fields;
}

/** Payload fields delivered to observers and never written to MongoDB. */
type ObserverOnlyField = 'transactionIndex' | 'tokenTransfer' | 'events' | 'tokenTransfers' | 'internalTransfers';
