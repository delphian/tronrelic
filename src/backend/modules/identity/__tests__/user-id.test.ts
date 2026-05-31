/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the Better Auth user-id boundary helpers.
 *
 * The contract under test: a Better Auth user id is the 24-character hex
 * form of the ObjectId `_id` stored on `module_user_auth_users`.
 * {@link toUserKey} converts the hex string to that ObjectId (null on
 * anything malformed, so callers no-match rather than throw), and
 * {@link userIdFromKey} converts it back so an ObjectId never leaves an
 * identity surface.
 */

import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { toUserKey, userIdFromKey } from '../services/user-id.js';

describe('user-id helpers', () => {
    describe('toUserKey', () => {
        it('converts a 24-char hex id to the matching ObjectId', () => {
            const hex = 'aaaaaaaaaaaaaaaaaaaaaaaa';
            const key = toUserKey(hex);
            expect(key).toBeInstanceOf(ObjectId);
            expect(key?.toHexString()).toBe(hex);
        });

        it('round-trips an ObjectId through hex and back', () => {
            const original = new ObjectId();
            const key = toUserKey(original.toHexString());
            expect(key?.equals(original)).toBe(true);
        });

        it.each([
            ['empty string', ''],
            ['too short', 'abc'],
            ['non-hex characters', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
            ['legacy-style id', 'user_abc'],
            ['25 hex chars', 'aaaaaaaaaaaaaaaaaaaaaaaaa']
        ])('returns null for a malformed id (%s)', (_label, value) => {
            expect(toUserKey(value)).toBeNull();
        });
    });

    describe('userIdFromKey', () => {
        it('returns the 24-char hex form of an ObjectId', () => {
            const id = new ObjectId();
            expect(userIdFromKey(id)).toBe(id.toHexString());
        });
    });
});
