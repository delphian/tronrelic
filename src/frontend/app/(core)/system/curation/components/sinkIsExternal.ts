/**
 * @fileoverview The single rule for whether a publish destination counts as
 * public. The review sheet's amber lane, the approve button's warning state,
 * and the publish confirmation all key off this one predicate, so they can
 * never disagree about what needs extra care.
 */

import type { ICurationEligibleSink } from '../../../../../modules/curation';

/**
 * Decide whether delivering to a sink exposes the content beyond admins and
 * internal systems. A sink counts as public when it either leaves the platform
 * (`egress` past `internal`) or widens the audience to everyone (`audience` is
 * `public`). Erring toward public is deliberate: a false warning costs one
 * confirmation click, while a false all-clear costs a publish that cannot be
 * taken back.
 *
 * @param reach - The sink's reach classification, as the content router reports it.
 * @returns True when delivering to this sink is a public or external exposure.
 */
export function sinkIsExternal(reach: ICurationEligibleSink['reach']): boolean {
    return reach.egress !== 'internal' || reach.audience === 'public';
}
