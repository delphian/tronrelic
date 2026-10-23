/**
 * @fileoverview Runs one of the `content.before*` veto hooks and turns a
 * handler's refusal into the content service's `vetoed` error.
 *
 * Writes to managed items and writes to their translations both fire these
 * hooks, and both must report a refusal the same way, so the one translation
 * lives here rather than in each service.
 *
 * @module backend/services/content-veto
 */

import type { HookDescriptor, IContentWriteContext, IHookRegistry } from '@/types';
import { isHookAbortError } from '@/types';
import { ContentError } from './content-error.js';

/**
 * Invoke a `content.before*` hook, translating a handler's `HookAbortError`
 * into a `vetoed` refusal. Any other error passes through unchanged.
 *
 * @param hookRegistry - The registry that runs the hook's handlers.
 * @param descriptor - The hook to run.
 * @param context - What is about to happen, to which item, and by whom.
 * @throws ContentError `vetoed` when a handler aborts.
 */
export async function runContentVeto(
    hookRegistry: IHookRegistry,
    descriptor: HookDescriptor<IContentWriteContext, void, 'series'>,
    context: IContentWriteContext
): Promise<void> {
    try {
        await hookRegistry.invoke(descriptor, context);
    } catch (error) {
        if (isHookAbortError(error)) {
            const subject = context.language ? `the translation ${context.operation}` : `the ${context.operation}`;
            throw new ContentError('vetoed', error.message || `A content hook refused ${subject}`);
        }
        throw error;
    }

    return;
}
