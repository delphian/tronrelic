/**
 * @fileoverview The one operation the sign-in audit hook needs from storage.
 *
 * The hook depends on this interface instead of the store class, so it can be
 * tested with a plain double and never reaches the database directly.
 */

import type { ISignInEventDocument } from '../database/ISignInEventDocument.js';

/**
 * Keeps a sign-in event so it can be searched later.
 */
export interface ISignInEventRecorder {
    /**
     * Store one event.
     *
     * @param event - The finished sign-in code request or sign-in attempt.
     * @returns Resolves once the event is stored.
     */
    record(event: ISignInEventDocument): Promise<void>;
}
