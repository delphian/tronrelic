/**
 * @fileoverview Client-side read cache for address tags, shared by every chip.
 *
 * The canonical `TronAddress` chip renders anywhere addresses appear — often
 * dozens of times in one table — and each instance wants the tags for its own
 * address. Fetching per chip would issue a request per row, so this module holds
 * one process-wide cache and coalesces every address requested inside the same
 * tick into a single `/api/address-tags/by-address` call. Chips subscribe, so a
 * later save invalidates one address and every chip showing it re-reads.
 *
 * Tags are an enhancement, never load-bearing: reads require a login, so an
 * anonymous visitor resolves to no tags and the chip renders exactly as before.
 * Failures are swallowed for the same reason — a tag lookup must never break the
 * address it decorates.
 */
'use client';

import { useEffect, useState } from 'react';
import { getTagsByAddresses } from '../api/client';
import { useAuthSession } from '../../user/components/SessionProvider';

/**
 * Addresses per outbound request. The backend caps a batch at 1000 items; this
 * lower bound keeps the query string well inside proxy URL limits while still
 * collapsing any realistic page's worth of chips into one or two calls.
 */
const MAX_BATCH = 100;

/** Resolved tags by address. An empty array is a cached "no tags" answer. */
const cache = new Map<string, string[]>();

/** Addresses queued for the next flush, not yet requested. */
let queued = new Set<string>();

/** Addresses currently in flight, so a re-render does not re-request them. */
const inFlight = new Set<string>();

/** Per-address subscribers, notified when that address's tags change. */
const subscribers = new Map<string, Set<() => void>>();

/** Pending flush handle; non-null means a batch is already scheduled. */
let flushHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Notify every chip watching an address that its tags changed.
 *
 * @param address - The address whose subscribers should re-read the cache.
 */
function notify(address: string): void {
    subscribers.get(address)?.forEach(listener => listener());
}

/**
 * Fetch the queued addresses and publish the answers.
 *
 * Every requested address is written to the cache — including the ones the
 * response carried no rows for — so an untagged address is answered from cache
 * next time instead of being re-requested by every chip that renders it.
 */
async function flush(): Promise<void> {
    flushHandle = null;
    const batch = [...queued].slice(0, MAX_BATCH);
    // Anything over the cap stays queued and goes out on the next flush.
    queued = new Set([...queued].slice(MAX_BATCH));
    if (queued.size > 0) {
        schedule();
    }
    if (batch.length === 0) {
        return;
    }
    batch.forEach(address => inFlight.add(address));
    try {
        const rows = await getTagsByAddresses(batch);
        const byAddress = new Map<string, string[]>();
        rows.forEach(row => {
            const tags = byAddress.get(row.address) ?? [];
            tags.push(row.tag);
            byAddress.set(row.address, tags);
        });
        batch.forEach(address => cache.set(address, byAddress.get(address) ?? []));
    } catch {
        // Anonymous visitor (401) or a transient failure: cache the empty
        // answer so the page does not retry per chip, and let an explicit
        // invalidation be the only thing that asks again.
        batch.forEach(address => cache.set(address, cache.get(address) ?? []));
    } finally {
        batch.forEach(address => {
            inFlight.delete(address);
            notify(address);
        });
    }
}

/**
 * Schedule a flush on the next macrotask, why: chips mount in one render pass,
 * so deferring by a tick lets the whole page's addresses land in one request.
 */
function schedule(): void {
    if (flushHandle === null) {
        flushHandle = setTimeout(() => { void flush(); }, 0);
    }
}

/**
 * Drop an address's cached tags and re-read it, so every chip showing that
 * address reflects an edit immediately rather than on the next full page load.
 *
 * @param address - The address whose assignments were just changed.
 */
export function invalidateAddressTags(address: string): void {
    cache.delete(address);
    queued.add(address);
    schedule();
}

/**
 * Subscribe one component to the tags of one address.
 *
 * @param address - Base58 address to read tags for. Falsy values are ignored so
 *        a caller need not branch before calling the hook.
 * @returns The address's tags, empty until they resolve (or if the visitor is
 *          not logged in, in which case they never do).
 */
export function useAddressTags(address: string | undefined): string[] {
    const { isLoggedIn } = useAuthSession();
    const [tags, setTags] = useState<string[]>(() => (address ? cache.get(address) ?? [] : []));

    useEffect(() => {
        if (!address || !isLoggedIn) {
            setTags([]);
            return undefined;
        }
        // Bound to a local so the closures below carry the narrowed type rather
        // than re-narrowing the possibly-undefined prop on every call.
        const key = address;
        /** Re-read this address from the shared cache after a batch resolves. */
        function readCache(): void {
            setTags(cache.get(key) ?? []);
        }
        const listeners = subscribers.get(key) ?? new Set<() => void>();
        listeners.add(readCache);
        subscribers.set(key, listeners);
        readCache();
        if (!cache.has(key) && !inFlight.has(key)) {
            queued.add(key);
            schedule();
        }
        return () => {
            listeners.delete(readCache);
            if (listeners.size === 0) {
                subscribers.delete(key);
            }
        };
    }, [address, isLoggedIn]);

    return tags;
}
