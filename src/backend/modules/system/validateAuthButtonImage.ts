/**
 * @fileoverview Validation for the header sign-in button image settings.
 *
 * An administrator picks this image once, and the site then renders it as an
 * `<img src>` in the header of every public page. A bad value would therefore
 * reach every visitor. The check below limits the URL to the two shapes a files
 * provider actually hands back — a root-relative path on this site, or an
 * absolute http(s) URL. That also refuses `javascript:` and `data:` values, and
 * protocol-relative `//host/...` URLs that would load from a host nobody chose.
 */

import type { ISystemConfig } from '@/types';

/** Longest URL accepted. Long enough for any real storage URL, short enough to refuse junk. */
export const AUTH_BUTTON_IMAGE_URL_MAX_LENGTH = 2048;

/** Longest file id accepted. Files-provider ids are short opaque tokens. */
export const AUTH_BUTTON_IMAGE_FILE_ID_MAX_LENGTH = 200;

/** Highest character code that is a control character or the space (0x00 to 0x20). */
const LAST_CONTROL_OR_SPACE_CODE = 0x20;

/** The DEL control character, which sits outside the 0x00 to 0x20 block. */
const DELETE_CODE = 0x7f;

/** What validation produced: the fields to save, or the reason it refused. */
export interface IAuthButtonImageValidation {
    /** Fields to write. Empty when the request carried neither of them. */
    updates: Partial<Pick<ISystemConfig, 'authButtonImageUrl' | 'authButtonImageFileId'>>;
    /** A message to return as a 400, or null when the request is acceptable. */
    error: string | null;
}

/**
 * Report whether a URL contains whitespace or a control character.
 *
 * Browsers silently strip some of these while parsing a URL, so a value that
 * reads as a harmless path can resolve somewhere else once rendered. None of
 * them appear in a URL a files provider returns, so any occurrence is refused.
 * The check compares character codes rather than using a regex range, so the
 * rule reads plainly and does not depend on escape sequences in the source.
 *
 * @param value - The trimmed URL an administrator submitted.
 * @returns True when at least one character is whitespace or a control character.
 */
function hasDisallowedCharacter(value: string): boolean {
    let found = false;

    for (const char of value) {
        const code = char.codePointAt(0) ?? 0;

        if (code <= LAST_CONTROL_OR_SPACE_CODE || code === DELETE_CODE || /\s/.test(char)) {
            found = true;
        }
    }

    return found;
}

/**
 * Decide whether a URL is safe to render as the header image.
 *
 * A value starting with `/` must be a plain root-relative path: `//` would make
 * it protocol-relative and point at another host, and a backslash is treated
 * as a slash by some browsers for the same effect. Anything else has to parse
 * as an absolute http or https URL.
 *
 * @param value - The trimmed URL an administrator submitted.
 * @returns True when the URL can be rendered without loading from an
 *          unintended host or running script.
 */
function isAllowedImageUrl(value: string): boolean {
    let allowed = false;

    if (hasDisallowedCharacter(value)) {
        allowed = false;
    } else if (value.startsWith('/')) {
        allowed = !value.startsWith('//') && !value.includes('\\');
    } else {
        try {
            const parsed = new URL(value);
            allowed = parsed.protocol === 'https:' || parsed.protocol === 'http:';
        } catch {
            allowed = false;
        }
    }

    return allowed;
}

/**
 * Check the sign-in button image fields on a system config update request.
 *
 * The URL and the file id are one setting, so they are validated and written
 * together. Sending a null or empty URL clears both. Sending a URL without a
 * file id stores the URL and clears the id, because keeping an id from an
 * earlier pick would leave the record naming one file while showing another.
 * A file id sent on its own is refused for the same reason: it would change
 * which file the record points at without changing the image shown.
 *
 * @param body - The parsed request body, of unknown shape until checked here.
 * @returns The fields to persist, plus the first problem found, so the caller
 *          can answer with one specific message instead of a generic refusal.
 */
export function validateAuthButtonImage(body: Record<string, unknown>): IAuthButtonImageValidation {
    const updates: IAuthButtonImageValidation['updates'] = {};
    let error: string | null = null;
    const rawUrl = body.authButtonImageUrl;
    const rawFileId = body.authButtonImageFileId;

    if (rawUrl === undefined) {
        if (rawFileId !== undefined) {
            error = 'authButtonImageFileId must be sent together with authButtonImageUrl';
        }
    } else if (rawUrl === null || (typeof rawUrl === 'string' && rawUrl.trim() === '')) {
        updates.authButtonImageUrl = null;
        updates.authButtonImageFileId = null;
    } else if (typeof rawUrl !== 'string') {
        error = 'authButtonImageUrl must be a string, or null to clear it';
    } else if (rawUrl.trim().length > AUTH_BUTTON_IMAGE_URL_MAX_LENGTH) {
        error = `authButtonImageUrl must be at most ${AUTH_BUTTON_IMAGE_URL_MAX_LENGTH} characters`;
    } else if (!isAllowedImageUrl(rawUrl.trim())) {
        error = 'authButtonImageUrl must be a root-relative path such as /uploads/... or an absolute http(s) URL';
    } else if (rawFileId !== undefined && rawFileId !== null && typeof rawFileId !== 'string') {
        error = 'authButtonImageFileId must be a string or null';
    } else if (typeof rawFileId === 'string' && rawFileId.trim().length > AUTH_BUTTON_IMAGE_FILE_ID_MAX_LENGTH) {
        error = `authButtonImageFileId must be at most ${AUTH_BUTTON_IMAGE_FILE_ID_MAX_LENGTH} characters`;
    } else {
        updates.authButtonImageUrl = rawUrl.trim();
        updates.authButtonImageFileId = typeof rawFileId === 'string' && rawFileId.trim() !== ''
            ? rawFileId.trim()
            : null;
    }

    const result: IAuthButtonImageValidation = { updates, error };

    return result;
}
