/**
 * @fileoverview Works out which of the three roles a rung is showing.
 */

import type { IOriginHop } from '../../../types';
import type { HopRole } from './ROLE_COPY';

/**
 * Decide what part the account on this rung played in the activation.
 *
 * The stream does not label the role directly; it states the facts the label is
 * derived from, and deriving it in one place keeps the rung and any future
 * summary from disagreeing. A hop that carries a caller means the climb followed
 * the signer of a contract call. Without a caller, an internal transaction means
 * the rung is the contract itself, because no signer could be read. Anything
 * else is an ordinary transfer from one account to another.
 *
 * @param hop - The hop to classify, as it arrived over the stream.
 * @returns The role to label this rung with.
 */
export function resolveHopRole(hop: IOriginHop): HopRole {
    let role: HopRole = 'funder';

    if (hop.callerAddress) {
        role = 'signer';
    } else if (hop.contractType === 'InternalTransaction') {
        role = 'contract';
    }

    return role;
}
