/**
 * @fileoverview Admin API client for the address-tags module.
 *
 * Thin fetch wrappers over `/api/admin/system/address-tags/*`. Same-origin
 * calls carry the Better Auth session cookie automatically, which the
 * backend's `requireAdmin` middleware consults — no token plumbing here.
 * Every function throws on a non-2xx response so callers surface the failure
 * in the UI.
 */

import type { IAddressTagPair, IAddressTagRename } from '@/types';

const BASE = '/api/admin/system/address-tags';

export type { IAddressTagPair, IAddressTagRename } from '@/types';

/**
 * Wire shape of one stored assignment — `IAddressTag` with its dates as the
 * ISO strings JSON delivers them in.
 */
export interface IAddressTagView extends IAddressTagPair {
    /** ISO timestamp of first creation. */
    createdAt: string;
    /** ISO timestamp of the last rename. */
    updatedAt: string;
}

/**
 * Unwrap a response or raise its error message so the UI can toast it.
 *
 * @param response - The fetch response to check.
 * @param what - Verb phrase naming the failed action for the error message.
 * @returns The parsed JSON body.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Failed to ${what} (HTTP ${response.status})`);
    }
    return response.json() as Promise<T>;
}

/**
 * Paged search over all assignments for the management table.
 *
 * @param query - Optional substring filter and pagination window.
 * @returns Matching assignments ordered by address then tag.
 */
export async function searchTags(query?: { search?: string; limit?: number; skip?: number }): Promise<IAddressTagView[]> {
    const params = new URLSearchParams();
    if (query?.search) params.set('search', query.search);
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    if (query?.skip !== undefined) params.set('skip', String(query.skip));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const data = await parse<{ tags: IAddressTagView[] }>(await fetch(`${BASE}/tags${suffix}`), 'search address tags');
    return data.tags;
}

/**
 * Create tag assignments (idempotent batch).
 *
 * @param tags - The `(address, tag)` pairs to create.
 * @returns The stored records now present for the pairs.
 */
export async function createTags(tags: IAddressTagPair[]): Promise<IAddressTagView[]> {
    const data = await parse<{ tags: IAddressTagView[] }>(await fetch(`${BASE}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
    }), 'create address tags');
    return data.tags;
}

/**
 * Rename tags in place (old → new per address).
 *
 * @param renames - The rename instructions to apply.
 * @returns The stored records now present under the new tags.
 */
export async function updateTags(renames: IAddressTagRename[]): Promise<IAddressTagView[]> {
    const data = await parse<{ tags: IAddressTagView[] }>(await fetch(`${BASE}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renames })
    }), 'rename address tags');
    return data.tags;
}

/**
 * Delete exact assignments.
 *
 * @param tags - The `(address, tag)` pairs to remove.
 * @returns The number of assignments removed.
 */
export async function deleteTags(tags: IAddressTagPair[]): Promise<number> {
    const data = await parse<{ deleted: number }>(await fetch(`${BASE}/tags/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
    }), 'delete address tags');
    return data.deleted;
}
