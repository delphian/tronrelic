import type { IContractEvent } from '../transaction/IContractEvent.js';
import type { ITokenTransferEvent } from '../transaction/ITokenTransferEvent.js';
import type { ITransaction } from '../transaction/ITransaction.js';

/**
 * One contract event delivered to an event observer, with the transaction it
 * came from.
 *
 * The transaction is included because an event alone does not say who signed
 * the call, whether the call succeeded overall, or which transaction type it
 * was, and an observer interpreting the event usually needs one of those. It is
 * the same object every other observer receives, not a copy.
 */
export interface IObservedContractEvent {
    /** The normalised event. */
    event: IContractEvent;

    /** The transaction that emitted the event. */
    transaction: ITransaction;

    /**
     * The decoded transfer, when core recognised the event as a standard
     * TRC20 or TRC721 `Transfer`. Saves the observer looking it up in
     * `transaction.payload.tokenTransfers` by `eventId`.
     */
    tokenTransfer?: ITokenTransferEvent;
}
