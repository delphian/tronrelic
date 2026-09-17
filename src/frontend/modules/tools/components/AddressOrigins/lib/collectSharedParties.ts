/**
 * @fileoverview Finds the accounts that more than one trace in the current
 * result set named, which is the signal the multi-wallet mode exists to surface.
 */

import type { IOriginLadder } from '../../../types';

/**
 * One trace's sighting of a shared account.
 */
export interface ISharedPartySighting {
    /** Which input wallet's ladder named the account. */
    sourceIndex: number;

    /** That input wallet's address, so the panel can name it without a lookup. */
    wallet: string;

    /**
     * How many steps up from the wallet the account was first reached, counting
     * the wallet itself as 0. Shown so a reader can tell a direct parent shared
     * by two wallets from a distant ancestor they happen to have in common.
     */
    step: number;
}

/**
 * An account reached by two or more of the traces on screen.
 */
export interface ISharedParty {
    /** The account itself. */
    address: string;

    /** Every trace that reached it, shallowest step first per trace. */
    sightings: ISharedPartySighting[];
}

/**
 * Collect the accounts named by more than one of the current traces.
 *
 * Why both parties of a hop count rather than only the one the climb followed:
 * two wallets created by the same sweeper contract share that contract even
 * though neither ladder climbs through it, and ignoring the party that was
 * stepped over would lose the strongest pattern the tool can show. The input
 * wallets themselves count too, at step 0, so "one of these wallets created
 * another" surfaces instead of being silently dropped.
 *
 * What this deliberately cannot show is how many *other* accounts a shared party
 * also created, which is why every surface built on it calls the result a lead
 * rather than proof.
 *
 * @param ladders - Every trace currently on screen, in any order.
 * @returns Shared accounts, most widely shared first, then shallowest, then by
 *          address so the order is stable while results are still streaming in.
 */
export function collectSharedParties(ladders: IOriginLadder[]): ISharedParty[] {
    // address -> sourceIndex -> shallowest sighting seen for that trace.
    const byAddress = new Map<string, Map<number, ISharedPartySighting>>();

    /**
     * Record one account against one trace, keeping whichever sighting sits
     * closest to that trace's wallet. Nested so it closes over `byAddress`
     * rather than threading the map through a parameter on every call.
     *
     * @param address - The account named by this trace.
     * @param ladder - The trace that named it.
     * @param step - Steps up from that trace's wallet, the wallet itself being 0.
     */
    const record = (address: string, ladder: IOriginLadder, step: number): void => {
        const perSource = byAddress.get(address) ?? new Map<number, ISharedPartySighting>();
        const existing = perSource.get(ladder.sourceIndex);
        if (!existing || step < existing.step) {
            perSource.set(ladder.sourceIndex, { sourceIndex: ladder.sourceIndex, wallet: ladder.address, step });
        }
        byAddress.set(address, perSource);
    };

    for (const ladder of ladders) {
        record(ladder.address, ladder, 0);
        for (const hop of ladder.hops) {
            // `depth` is 0-based on the wire and the wallet occupies step 0 here,
            // so the first ancestor is step 1.
            const step = hop.depth + 1;
            record(hop.climbedAddress, ladder, step);
            record(hop.activatorAddress, ladder, step);
        }
    }

    const shared: ISharedParty[] = [];
    for (const [address, perSource] of byAddress) {
        if (perSource.size >= 2) {
            const sightings = [...perSource.values()].sort((a, b) => a.step - b.step || a.sourceIndex - b.sourceIndex);
            shared.push({ address, sightings });
        }
    }

    shared.sort((a, b) =>
        b.sightings.length - a.sightings.length
        || a.sightings[0].step - b.sightings[0].step
        || a.address.localeCompare(b.address));

    return shared;
}
