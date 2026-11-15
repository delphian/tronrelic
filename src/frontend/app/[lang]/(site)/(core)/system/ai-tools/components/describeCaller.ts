/**
 * @fileoverview Turns the actor and origin stored on an audit record into a
 * name an admin can recognise.
 *
 * The record keeps ids: a 24-character Better Auth user id for a signed-in
 * person, or a salted network hash for an anonymous MCP caller. Read raw, an
 * admin has to look each one up by hand. The activity endpoint sends email
 * addresses for the user ids on the page, and this helper picks the best name
 * from those, so the table and the detail panel label a caller the same way.
 */

import type { IToolInvocationRecord } from '@/types';

/** How one caller is shown. */
export interface IInvocationCaller {
    /** The name to lead with: an email address when known, otherwise a description. */
    primary: string;

    /** What kind of caller this is, such as "Signed-in member" or "Admin". */
    kind: string;

    /** The stored id behind the name, for copying or searching; null when there is none. */
    id: string | null;
}

/**
 * Describe who made a call, preferring an email address over an id.
 *
 * An MCP call's origin is read first, because its principal is the person or
 * network the call is counted against, which is what an admin looking at MCP
 * traffic wants. Other calls fall back to the actor.
 *
 * @param record - The audit record.
 * @param userLabels - Email addresses keyed by user id, from the activity
 *   endpoint. An id missing from it is shown as the id itself.
 * @returns The caller's name, kind, and id.
 */
export function describeCaller(record: IToolInvocationRecord, userLabels: Readonly<Record<string, string>>): IInvocationCaller {
    const origin = record.origin;
    let caller: IInvocationCaller;
    if (origin?.principalKind === 'anonymous' || record.actor.kind === 'anonymous') {
        caller = { primary: 'Anonymous caller', kind: 'Not signed in', id: origin?.principalId ?? record.actor.id ?? null };
    } else if (origin?.principalKind === 'user' && origin.principalId) {
        caller = { primary: userLabels[origin.principalId] ?? origin.principalId, kind: 'Signed-in member', id: origin.principalId };
    } else if (record.actor.kind === 'system') {
        caller = { primary: 'System', kind: 'Scheduled or programmatic run', id: record.actor.id ?? null };
    } else {
        const id = record.actor.id ?? null;
        const label = id ? userLabels[id] ?? id : 'Unknown';
        caller = { primary: label, kind: record.actor.kind === 'admin' ? 'Admin' : 'Signed-in user', id };
    }
    return caller;
}
