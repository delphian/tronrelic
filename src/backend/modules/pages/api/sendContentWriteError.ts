/**
 * @fileoverview The HTTP response for a failed write to managed content.
 *
 * Pages and page translations are both managed content, so their admin routes
 * fail in the same ways and must report those failures with the same statuses.
 * Keeping the mapping here means the two controllers cannot drift apart.
 *
 * @module backend/modules/pages/api/sendContentWriteError
 */

import type { Response } from 'express';
import type { ContentErrorCode } from '@/types';
import { isContentError } from '../../../services/content-error.js';

/**
 * HTTP status for each content service refusal. `vetoed` is a policy refusal
 * (403); `curation-unavailable` means the change needs a reviewer the server
 * cannot reach right now (503).
 */
export const CONTENT_ERROR_STATUS: Record<ContentErrorCode, number> = {
    'unknown-type': 500,
    'not-found': 404,
    'deleted': 409,
    'not-deleted': 409,
    'vetoed': 403,
    'curation-unavailable': 503,
    'superseded': 409
};

/**
 * Send a write failure with the status its cause deserves: the mapped status
 * for a content service refusal, 400 for a validation error the content type
 * threw.
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
