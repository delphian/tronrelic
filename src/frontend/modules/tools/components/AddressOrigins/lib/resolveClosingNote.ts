/**
 * @fileoverview Turns a finished trace's terminal state into the line printed
 * at the foot of its ladder.
 */

import { AlertTriangle, Flag, type LucideIcon } from 'lucide-react';
import type { IOriginLadder } from '../../../types';

/**
 * How the closing line should read visually.
 *
 * There is deliberately no success tone. The furthest a chain can get is an
 * account with no attributable activator, and the backend's own type doc says
 * that state cannot distinguish a true root from an activation this provider
 * simply cannot resolve. Colouring that green would assert an origin had been
 * found, which is the exact reading the page's guide tells the reader to avoid.
 * It gets the neutral tone; the endings that are outright limits keep warning
 * and danger.
 */
export type ClosingNoteTone = 'neutral' | 'warning' | 'danger';

/**
 * The closing line for one finished trace.
 */
export interface IClosingNote {
    /** Colour treatment for the line. */
    tone: ClosingNoteTone;

    /** Leading glyph, decorative — the text carries the meaning. */
    icon: LucideIcon;

    /** What to tell the reader about why the climb stopped. */
    text: string;
}

/**
 * Word the ending of a trace, or return nothing while it is still climbing.
 *
 * Why each ending needs its own sentence: a chain that stopped because the
 * provider has no more indexed history looks identical to one that reached a
 * true origin, and a reader who cannot tell them apart will treat a gap in the
 * record as a finding. Every branch below says which happened.
 *
 * @param ladder - The trace to describe, at whatever state it has reached.
 * @param isLoggedIn - Whether the reader is signed in. An anonymous trace always
 *        stops at its one-step tier cap, so the generic depth-cap warning would
 *        fire on every successful anonymous trace and say nothing the sign-in
 *        prompt beneath it does not say better.
 * @returns The closing line, or `null` while the trace is still running or when
 *          the only thing to say is the tier prompt shown separately.
 */
export function resolveClosingNote(ladder: IOriginLadder, isLoggedIn: boolean): IClosingNote | null {
    let note: IClosingNote | null = null;

    if (ladder.status === 'error') {
        note = {
            tone: 'danger',
            icon: AlertTriangle,
            text: ladder.errorMessage ?? 'Interrupted before the trace finished. Please retry.'
        };
    } else if (ladder.status === 'done') {
        if (ladder.stopReason === 'unresolved' && ladder.hops.length > 0) {
            note = {
                tone: 'neutral',
                icon: Flag,
                text: 'Chain ends here — the last account has no activator we can attribute. It may be a true origin, or its funding may not be traceable.'
            };
        } else if (ladder.stopReason === 'unresolved') {
            note = {
                tone: 'warning',
                icon: AlertTriangle,
                text: 'No activator could be attributed for this wallet — its funding transfer is not traceable to a sender.'
            };
        } else if (ladder.stopReason === 'depth-cap' && isLoggedIn) {
            note = {
                tone: 'warning',
                icon: AlertTriangle,
                text: 'Stopped at the depth cap — a limit, not the end of the chain.'
            };
        } else if (ladder.stopReason === 'cycle') {
            note = {
                tone: 'warning',
                icon: AlertTriangle,
                text: 'Stopped — the chain repeated an account it had already passed through.'
            };
        } else if (ladder.stopReason === 'provider-error') {
            note = {
                tone: 'warning',
                icon: AlertTriangle,
                text: 'Tracing was interrupted before the chain ended. Please retry.'
            };
        }
    }

    return note;
}
