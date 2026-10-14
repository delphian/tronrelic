/// <reference types="vitest" />

/**
 * @fileoverview Tests for the read-only ignore-list view the traffic module
 * publishes as `'traffic-ignore-list'`. They pin how a request is turned into
 * the user id and tid that get checked, since a plugin relies on this class to
 * read the session and the analytics cookie for it.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IHttpRequest, ITrafficIgnoreSubject } from '@/types';
import { TrafficIgnoreList } from '../services/TrafficIgnoreList.js';

const TID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Build the smallest request the class reads: the attached session and the
 * parsed cookies, which at runtime come from core's middleware.
 *
 * @param userId - Logged-in user id, or null for an anonymous request.
 * @param cookies - Cookies cookie-parser would have attached.
 * @returns A request double typed as a plugin route receives it.
 */
function createRequest(userId: string | null, cookies: Record<string, string> = {}): IHttpRequest {
    const authSession = userId ? { user: { id: userId } } : null;
    return { authSession, cookies } as unknown as IHttpRequest;
}

describe('TrafficIgnoreList', () => {
    it('delegates isIgnored() to the cached list unchanged', () => {
        const lookup = { isIgnored: vi.fn(() => true) };
        const list = new TrafficIgnoreList(lookup);
        const subject: ITrafficIgnoreSubject = { userId: 'u1', tid: TID };

        expect(list.isIgnored(subject)).toBe(true);
        expect(lookup.isIgnored).toHaveBeenCalledWith(subject);
    });

    it('reads the session user id and the tid cookie from a request', () => {
        const lookup = { isIgnored: vi.fn(() => false) };
        const list = new TrafficIgnoreList(lookup);

        list.isRequestIgnored(createRequest('u1', { tronrelic_tid: TID }));

        expect(lookup.isIgnored).toHaveBeenCalledWith({ userId: 'u1', tid: TID });
    });

    it('passes nulls for an anonymous request with no analytics cookie', () => {
        const lookup = { isIgnored: vi.fn(() => false) };
        const list = new TrafficIgnoreList(lookup);

        list.isRequestIgnored(createRequest(null));

        expect(lookup.isIgnored).toHaveBeenCalledWith({ userId: null, tid: null });
    });

    it('drops a malformed tid cookie rather than matching on it', () => {
        const lookup = { isIgnored: vi.fn(() => false) };
        const list = new TrafficIgnoreList(lookup);

        list.isRequestIgnored(createRequest(null, { tronrelic_tid: 'not-a-uuid' }));

        expect(lookup.isIgnored).toHaveBeenCalledWith({ userId: null, tid: null });
    });

    it('returns the cached list answer for a request', () => {
        const list = new TrafficIgnoreList({ isIgnored: () => true });

        expect(list.isRequestIgnored(createRequest(null, { tronrelic_tid: TID }))).toBe(true);
    });
});
