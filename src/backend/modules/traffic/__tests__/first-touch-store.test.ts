/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the first-touch store.
 *
 * The network-mismatch rule condition depends on this store recalling a
 * cookie's page load, and on it staying bounded in memory.
 */

import { describe, it, expect } from 'vitest';
import { FirstTouchStore } from '../services/first-touch-store.js';

const TID = '550e8400-e29b-41d4-a716-446655440000';

describe('FirstTouchStore', () => {
    it('recalls a remembered page load, ignoring the tid\'s case', () => {
        const store = new FirstTouchStore();
        store.remember(TID, { asn: 12849, country: 'IL', at: 1000 });

        expect(store.recall(TID.toUpperCase(), 2000)).toEqual({ asn: 12849, country: 'IL', at: 1000 });
    });

    it('returns null for an unknown tid', () => {
        expect(new FirstTouchStore().recall(TID, 1000)).toBeNull();
    });

    it('forgets an entry once it expires', () => {
        const store = new FirstTouchStore(10, 500);
        store.remember(TID, { asn: 1, country: 'SG', at: 1000 });

        expect(store.recall(TID, 1600)).toBeNull();
    });

    it('drops the oldest entry once full', () => {
        const store = new FirstTouchStore(2);
        store.remember('a', { asn: 1, country: null, at: 1 });
        store.remember('b', { asn: 2, country: null, at: 2 });
        store.remember('c', { asn: 3, country: null, at: 3 });

        expect(store.recall('a', 4)).toBeNull();
        expect(store.recall('b', 4)?.asn).toBe(2);
        expect(store.recall('c', 4)?.asn).toBe(3);
    });

    it('treats a rewrite as the newest entry', () => {
        const store = new FirstTouchStore(2);
        store.remember('a', { asn: 1, country: null, at: 1 });
        store.remember('b', { asn: 2, country: null, at: 2 });
        store.remember('a', { asn: 9, country: null, at: 3 });
        store.remember('c', { asn: 3, country: null, at: 4 });

        expect(store.recall('b', 5)).toBeNull();
        expect(store.recall('a', 5)?.asn).toBe(9);
    });
});
