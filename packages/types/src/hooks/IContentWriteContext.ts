/**
 * @fileoverview Payload for the `content.beforeCreate`, `content.beforeUpdate`,
 * `content.beforeDelete`, and `content.beforeRestore` series hooks.
 *
 * Every write to managed content passes through the core content service,
 * which fires one of these hooks before it calls the content author. A handler
 * that throws `HookAbortError` stops the write, and the service refuses the
 * operation with the `vetoed` error code and the handler's message. That gives
 * any module or plugin a place to enforce a rule over all content — for
 * example, refusing text that names a sanctioned wallet — without the content
 * author knowing about it.
 *
 * @module types/hooks/IContentWriteContext
 */

import type { IContentActor } from '../content/IContentActor.js';

/**
 * Context handed to the `content.before*` hooks — what is about to happen, to
 * which item, and by whom.
 */
export interface IContentWriteContext {
    /** The operation about to run. Matches the hook that fired. */
    operation: 'create' | 'update' | 'delete' | 'restore';

    /** The managed content type, for example `core:page`. */
    typeId: string;

    /**
     * The content id. For a create this is the id core has just issued; the
     * item does not exist yet.
     */
    id: string;

    /** Who is performing the operation. */
    actor: IContentActor;

    /**
     * The caller's input for a create or update, exactly as the content author
     * will receive it. Its shape belongs to the content type, so a handler that
     * inspects it must check the `typeId` first. Absent for delete and restore.
     */
    input?: unknown;
}
