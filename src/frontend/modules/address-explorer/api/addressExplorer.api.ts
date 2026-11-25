/**
 * @fileoverview Browser-side requests for the address page's data.
 *
 * Both are same-origin fetches, so the browser attaches the session cookie and
 * the backend's login gate sees the visitor. The first page load is rendered
 * on the server; these back the span selector and "Load older" only.
 */

import type {
    AddressExplorerPeriod,
    AddressExplorerSection,
    IAddressExplorerOverview,
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
 * Fetch every section of the address page for a summary span.
 *
 * @param address - The base58 address the page is showing.
 * @param period - The span the visitor picked.
 * @returns The page's sections.
 */
export async function fetchAddressOverview(address: string, period: AddressExplorerPeriod): Promise<IAddressExplorerOverview> {
    const params = new URLSearchParams({ period });
    const body = await readJson<{ overview: IAddressExplorerOverview }>(
        await fetch(`${API_BASE}/${encodeURIComponent(address)}?${params.toString()}`, { cache: 'no-store' })
    );
    return body.overview;
}

/**
 * Fetch the next older page of transfers.
 *
 * @param address - The base58 address the page is showing.
 * @param next - The `next` position the previous page returned, passed back unchanged.
 * @returns The page, read or failed.
 */
export async function fetchAddressTransfers(
    address: string,
    next: IAddressExplorerTransfersCursor
): Promise<AddressExplorerSection<IAddressExplorerTransfers>> {
    const params = new URLSearchParams({ before: next.before, ...(next.cursor ? { cursor: next.cursor } : {}) });
    const body = await readJson<{ transfers: AddressExplorerSection<IAddressExplorerTransfers> }>(
        await fetch(`${API_BASE}/${encodeURIComponent(address)}/transfers?${params.toString()}`, { cache: 'no-store' })
    );
    return body.transfers;
}
