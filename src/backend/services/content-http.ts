/**
 * @fileoverview The HTTP response for a failed write to managed content.
 *
 * Pages, their translations, and every later content type's admin routes fail
 * in the same ways, through the same core content service, and must report
 * those failures with the same statuses. Keeping the mapping here means the
 * routes cannot drift apart.
 *
 * @module backend/services/content-http
 */

import type { Response } from 'express';
import type { ContentErrorCode } from '@/types';
import { isContentError } from './content-error.js';

/**
 * HTTP status for each content service refusal. `vetoed` and `forbidden` are
 * policy refusals (403); `curation-unavailable` means the change needs a
 * reviewer the server cannot reach right now (503).
 */
export const CONTENT_ERROR_STATUS: Record<ContentErrorCode, number> = {
    'unknown-type': 500,
    'not-found': 404,
    'deleted': 409,
    'not-deleted': 409,
    'vetoed': 403,
    'curation-unavailable': 503,
    'superseded': 409,
    'forbidden': 403
};

/**
 * Send a write failure with the status its cause deserves: the mapped status
 * for a content service refusal, 400 for a validation error the content type
 * or the content service threw.
 *
 * @param res - The response to write.
 * @param label - The `error` field, naming the operation that failed.
 * @param error - The caught error.
 */
export function sendContentWriteError(res: Response, label: string, error: unknown): void {
    const status = isContentError(error) ? CONTENT_ERROR_STATUS[error.code] : 400;
    res.status(status).json({
        error: label,
        code: isContentError(error) ? error.code : undefined,
        message: error instanceof Error ? error.message : 'Unknown error',
    });

    return;
}
