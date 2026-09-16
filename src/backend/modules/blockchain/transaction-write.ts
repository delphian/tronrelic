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
 * @param payload - The transaction as block sync prepared it, including the
 *                  fields only observers read.
 * @returns The same fields minus `transactionIndex`, ready to spread into
 *          `$set`.
 */
export function toTransactionWriteFields(
    payload: ITransactionPersistencePayload
): Omit<ITransactionPersistencePayload, 'transactionIndex'> {
    const { transactionIndex: _observerOnly, ...fields } = payload;
    return fields;
}
