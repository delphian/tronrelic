/**
 * @fileoverview Turns a stored sign-in event into the shape admin tooling
 * reports, shared by the user detail panel and the identity AI tools so the
 * two always show the same fields.
 */

import type { IAccountSignInEvent } from '@/types';
import type { ISignInEventDocument } from '../database/ISignInEventDocument.js';

/**
 * Copy a stored event's reportable fields one by one, with the time as text.
 * Copying named fields means a field added to the document later is not
 * shown until someone decides it should be; `path` is left out on purpose.
 *
 * @param event - The stored event.
 * @returns The event as admin tooling reports it.
 */
export function toSignInEventView(event: ISignInEventDocument): IAccountSignInEvent {
    return {
        occurredAt: new Date(event.occurredAt).toISOString(),
        kind: event.kind,
        method: event.method,
        email: event.email,
        userId: event.userId,
        sessionId: event.sessionId,
        ip: event.ip,
        forwardedFor: event.forwardedFor,
        country: event.country,
        userAgent: event.userAgent,
        status: event.status,
        reason: event.reason
    };
}
