/// <reference types="vitest" />

/**
 * @fileoverview Tests for the sign-in button image validator.
 *
 * The image URL is rendered on every public page, so these tests pin down both
 * halves of the contract: the shapes a files provider returns are accepted, and
 * the shapes that would run script or load from another host are refused.
 */

import { describe, it, expect } from 'vitest';
import {
    validateAuthButtonImage,
    AUTH_BUTTON_IMAGE_URL_MAX_LENGTH,
    AUTH_BUTTON_IMAGE_FILE_ID_MAX_LENGTH
} from '../validateAuthButtonImage.js';

describe('validateAuthButtonImage', () => {
    /**
     * A save from another card on the Configuration tab carries neither field
     * and must pass through untouched rather than clearing the image.
     */
    it('returns no updates when neither field is sent', () => {
        const result = validateAuthButtonImage({ siteUrl: 'https://tronrelic.com' });
        expect(result).toEqual({ updates: {}, error: null });
    });

    /**
     * The ordinary case: the files provider returned a root-relative upload
     * path and an inventory id, and both are stored as given. The stored name
     * is a UUID, so the hyphens in it must not trip the character check.
     */
    it('accepts a root-relative upload path together with its file id', () => {
        const url = '/uploads/plugin/files/26/09/3f2a9c1e-7b4d-4e2a-9f1c-0d5e6a7b8c9d.png';
        const result = validateAuthButtonImage({
            authButtonImageUrl: url,
            authButtonImageFileId: 'file-123'
        });
        expect(result.error).toBeNull();
        expect(result.updates).toEqual({
            authButtonImageUrl: url,
            authButtonImageFileId: 'file-123'
        });
    });

    /**
     * A provider backed by object storage may return an absolute URL.
     */
    it('accepts an absolute https URL', () => {
        const result = validateAuthButtonImage({
            authButtonImageUrl: 'https://cdn.example.com/mascot.png',
            authButtonImageFileId: 'file-9'
        });
        expect(result.error).toBeNull();
        expect(result.updates.authButtonImageUrl).toBe('https://cdn.example.com/mascot.png');
    });

    /**
     * Removing the image sends null, which must clear the id as well so the
     * record does not keep pointing at a file that is no longer shown.
     */
    it('clears both fields when the URL is null', () => {
        const result = validateAuthButtonImage({ authButtonImageUrl: null });
        expect(result).toEqual({
            updates: { authButtonImageUrl: null, authButtonImageFileId: null },
            error: null
        });
    });

    /**
     * An empty or whitespace-only string means the same as null.
     */
    it('clears both fields when the URL is blank', () => {
        const result = validateAuthButtonImage({ authButtonImageUrl: '   ', authButtonImageFileId: 'file-1' });
        expect(result.updates).toEqual({ authButtonImageUrl: null, authButtonImageFileId: null });
        expect(result.error).toBeNull();
    });

    /**
     * A URL that arrives without an id replaces the image, so the id from an
     * earlier pick must not survive beside it.
     */
    it('drops the file id when a URL arrives without one', () => {
        const result = validateAuthButtonImage({ authButtonImageUrl: '/uploads/a.png' });
        expect(result.updates).toEqual({ authButtonImageUrl: '/uploads/a.png', authButtonImageFileId: null });
    });

    /**
     * Each of these would either run script, load from a host nobody chose, or
     * resolve relative to whatever page the header happens to be on.
     */
    it.each([
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        '//evil.example/a.png',
        '/\\evil.example/a.png',
        'uploads/a.png',
        'ftp://files.example/a.png',
        '/uploads/a b.png',
        '/uploads/a\tb.png'
    ])('rejects %j', (url) => {
        const result = validateAuthButtonImage({ authButtonImageUrl: url });
        expect(result.error).not.toBeNull();
        expect(result.updates).toEqual({});
    });

    /**
     * An oversized URL is refused rather than stored and rendered.
     */
    it('rejects a URL over the length limit', () => {
        const url = `/uploads/${'a'.repeat(AUTH_BUTTON_IMAGE_URL_MAX_LENGTH)}.png`;
        const result = validateAuthButtonImage({ authButtonImageUrl: url });
        expect(result.error).toContain(String(AUTH_BUTTON_IMAGE_URL_MAX_LENGTH));
    });

    /**
     * An oversized file id is refused even when the URL is fine.
     */
    it('rejects a file id over the length limit', () => {
        const result = validateAuthButtonImage({
            authButtonImageUrl: '/uploads/a.png',
            authButtonImageFileId: 'x'.repeat(AUTH_BUTTON_IMAGE_FILE_ID_MAX_LENGTH + 1)
        });
        expect(result.error).toContain(String(AUTH_BUTTON_IMAGE_FILE_ID_MAX_LENGTH));
        expect(result.updates).toEqual({});
    });

    /**
     * A file id on its own would change which file the record names without
     * changing the image shown, so it is refused.
     */
    it('rejects a file id sent without a URL', () => {
        const result = validateAuthButtonImage({ authButtonImageFileId: 'file-1' });
        expect(result.error).toBe('authButtonImageFileId must be sent together with authButtonImageUrl');
    });

    /**
     * A URL of the wrong type is refused rather than coerced.
     */
    it('rejects a non-string URL', () => {
        const result = validateAuthButtonImage({ authButtonImageUrl: 42 });
        expect(result.error).toBe('authButtonImageUrl must be a string, or null to clear it');
    });
});
