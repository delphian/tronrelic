/**
 * @fileoverview Browser-side requests for the address page's data.
 *
 * Both are same-origin fetches, so the browser attaches the session cookie and
 * the backend's login gate sees the visitor. The first page load is rendered
 * and streamed by the server; these back the span selector, each section's
 * retry, and "Load older" only.
 */

import type {
    AddressExplorerPeriod,
    AddressExplorerSection,
    AddressExplorerSpanSection,
    IAddressExplorerSpanSections,
    IAddressExplorerTransfers,
    IAddressExplorerTransfersCursor
} from '@/types';

/** Base path of the address page's API. */
const API_BASE = '/api/address-explorer';

/**
 * Read a JSON body, throwing on a non-2xx status so the caller shows its
 * error state instead of rendering a body that is an error message.
 *
 * @param response - The fetch response.
 * @returns The parsed body.
 * @throws Error naming the status when the request failed.
 */
async function readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
        throw new Error(`Address page request failed with status ${response.status}`);
    }
    return await response.json() as T;
}

/**
 * Fetch one span section of the address page.
 *
 * @param address - The base58 address the page is showing.
 * @param section - Which section to read.
 * @param period - The span the visitor picked.
 * @returns The section, read or failed.
 * @throws Error when the request itself failed.
 */
export async function fetchAddressSpanSection<K extends AddressExplorerSpanSection>(
    address: string,
    section: K,
    period: AddressExplorerPeriod
): Promise<AddressExplorerSection<IAddressExplorerSpanSections[K]>> {
    const params = new URLSearchParams({ period });
    const body = await readJson<{ section: AddressExplorerSection<IAddressExplorerSpanSections[K]> }>(
        await fetch(`${API_BASE}/${encodeURIComponent(address)}/sections/${section}?${params.toString()}`, { cache: 'no-store' })
    );
    return body.section;
}

/**
 * Fetch a page of transfers: the newest page, or the next older one.
 *
 * @param address - The base58 address the page is showing.
 * @param next - The `next` position the previous page returned, passed back unchanged, or omitted for the newest page.
 * @returns The page, read or failed.
 * @throws Error when the request itself failed.
 */
export async function fetchAddressTransfers(
    address: string,
    next?: IAddressExplorerTransfersCursor
): Promise<AddressExplorerSection<IAddressExplorerTransfers>> {
    const params = new URLSearchParams(next ? { before: next.before, ...(next.cursor ? { cursor: next.cursor } : {}) } : {});
    const query = params.toString();
    const body = await readJson<{ transfers: AddressExplorerSection<IAddressExplorerTransfers> }>(
        await fetch(`${API_BASE}/${encodeURIComponent(address)}/transfers${query ? `?${query}` : ''}`, { cache: 'no-store' })
    );
    return body.transfers;
}
