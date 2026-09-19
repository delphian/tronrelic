/**
 * @fileoverview The error the core content service throws when it refuses an
 * operation.
 *
 * Every refusal carries a `ContentErrorCode` so a caller branches on the
 * reason rather than on message text — an admin route maps `not-found` to 404
 * and `vetoed` to 403, a plugin decides whether a `curation-unavailable`
 * refusal is worth retrying. Callers outside core cannot rely on `instanceof`
 * across bundles, so they read the `code` property instead; `isContentError`
 * does the same for core call sites.
 *
 * @module backend/services/content-error
 */

import type { ContentErrorCode } from '@/types';

/**
 * A refused content operation, tagged with the reason.
 */
export class ContentError extends Error {
    /**
     * @param code - The machine-readable reason, from `ContentErrorCode`.
     * @param message - The human-readable explanation, safe to show an admin.
     */
    constructor(
        public readonly code: ContentErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'ContentError';
    }
}

/**
 * Whether a caught value is a content service refusal. Checks the `code`
 * property rather than the class, so it also recognizes a refusal raised by a
 * copy of this class from another bundle.
 *
 * @param error - The caught value.
 * @returns True when the value carries a content error code.
 */
export function isContentError(error: unknown): error is ContentError {
    const codes: ReadonlyArray<ContentErrorCode> = [
        'unknown-type',
        'not-found',
        'deleted',
        'not-deleted',
        'vetoed',
        'curation-unavailable',
        'superseded'
    ];
    const code = (error as { code?: unknown } | null)?.code;

    return error instanceof Error && typeof code === 'string' && (codes as ReadonlyArray<string>).includes(code);
}
