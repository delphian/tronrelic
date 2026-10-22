/**
 * @fileoverview Convert a stored language document to the API shape.
 *
 * Both the admin service and the read service return languages, so the
 * conversion lives in one place and the two cannot disagree on the shape.
 */

import type { ILanguage } from '@/types';
import type { ILanguageDocument } from '../database/index.js';

/**
 * Convert a stored language to its wire form, turning dates into ISO strings
 * so the value survives JSON unchanged.
 *
 * @param document - Stored language.
 * @returns The API shape.
 */
export function toLanguage(document: ILanguageDocument): ILanguage {
    return {
        code: document.code,
        name: document.name,
        nativeName: document.nativeName,
        direction: document.direction,
        enabled: document.enabled,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString()
    };
}
