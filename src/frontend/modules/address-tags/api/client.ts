/**
 * @fileoverview API client for the address-tags module.
 *
 * Thin fetch wrappers over the module's two HTTP surfaces: the read-only user
 * routes (`/api/address-tags/*`, `requireLogin`) and the mutation routes
 * (`/api/admin/system/address-tags/*`, `requireAdmin`). Same-origin calls carry
 * the Better Auth session cookie automatically, which those gates consult — no
 * token plumbing here. Every function throws on a non-2xx response so callers
 * surface the failure in the UI.
 *
 * The split matters to callers: any logged-in visitor may *read* an address's
 * tags, but only an admin may change them, so a UI offering an edit affordance
 * gates it on admin group membership rather than on login.
 */

import type { IAddressTagPair, IAddressTagRename } from '@/types';

const BASE = '/api/admin/system/address-tags';
const USER_BASE = '/api/address-tags';

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
 * Wire shape of one address and every tag on it — `IAddressTagGroup` with its
 * dates as the ISO strings JSON delivers them in.
 */
export interface IAddressTagGroupView {
    /** The tagged TRON address. */
    address: string;
    /** Every assignment on this address, ordered by tag. */
    tags: IAddressTagView[];
    /** ISO timestamp of the most recently changed tag on this address. */
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
 * Read every tag assigned to the given addresses.
 *
 * Batched by design: the caller passes as many addresses as it needs rendered,
 * so a table of a hundred chips costs one request instead of a hundred. Reads
 * are gated on `requireLogin`, so an anonymous visitor gets a 401 here — treat
 * tags as an absent enhancement in that case rather than an error to surface.
 *
 * @param addresses - Base58 addresses to look up; a single address is a
 *        one-element array.
 * @returns Every stored `(address, tag)` assignment across those addresses.
 */
export async function getTagsByAddresses(addresses: string[]): Promise<IAddressTagView[]> {
    const query = new URLSearchParams({ addresses: addresses.join(',') });
    const data = await parse<{ tags: IAddressTagView[] }>(
        await fetch(`${USER_BASE}/by-address?${query.toString()}`),
        'load address tags'
    );
    return data.tags;
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
 * Typeahead lookup backing the shared `AddressSelector` control.
 *
 * Matches the term against both address text and tag text and returns whole
 * addresses with their full tag lists, so the dropdown can show an address
 * alongside the tags that explain why it surfaced. Reads are `requireLogin`, so
 * an anonymous visitor gets a 401 — callers should treat suggestions as an
 * absent enhancement in that case, never as an error to surface.
 *
 * @param search - The partial address or tag text the user has typed.
 * @param limit - Maximum number of addresses to offer.
 * @returns Matching addresses, each with every tag attached to it.
 */
export async function suggestAddresses(search: string, limit?: number): Promise<IAddressTagGroupView[]> {
    const params = new URLSearchParams({ search });
    if (limit !== undefined) params.set('limit', String(limit));
    const data = await parse<{ addresses: IAddressTagGroupView[] }>(
        await fetch(`${USER_BASE}/suggest?${params.toString()}`),
        'suggest addresses'
    );
    return data.addresses;
}

/**
 * Paged, address-oriented search for the management table.
 *
 * Prefer this over `searchTags` wherever a row represents an address: the
 * server pages by address and returns each address's complete tag list, so a
 * grouped table cannot show the same address twice with a split list — which
 * is exactly what grouping a page of flat assignments client-side would do.
 *
 * @param query - Optional substring filter and address-wise pagination window.
 * @returns Matching addresses ordered ascending, each with all of its tags.
 */
export async function searchAddresses(query?: { search?: string; limit?: number; skip?: number }): Promise<IAddressTagGroupView[]> {
    const params = new URLSearchParams();
    if (query?.search) params.set('search', query.search);
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    if (query?.skip !== undefined) params.set('skip', String(query.skip));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const data = await parse<{ addresses: IAddressTagGroupView[] }>(
        await fetch(`${BASE}/addresses${suffix}`),
        'search tagged addresses'
    );
    return data.addresses;
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
