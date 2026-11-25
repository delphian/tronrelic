/**
 * @fileoverview Server-side reads of the address page's sections.
 *
 * The page streams: the server starts every section's read at once, sends the
 * page straight away, and adds each section as its read finishes. These
 * helpers start the reads. They run during server rendering only, because
 * they read the incoming request's headers.
 *
 * - The visitor's cookie is forwarded so the backend's login gate sees their
 *   session.
 * - The visitor's address goes out as `X-Forwarded-For`. These calls leave
 *   from the frontend container, so without it the backend's per-IP rate
 *   limit would count every visitor as one client.
 */

import { headers } from 'next/headers';
import type {
    AddressExplorerErrorReason,
    AddressExplorerPeriod,
    AddressExplorerSection,
    AddressExplorerSpanSection,
    IAddressExplorerSpanSections,
    IAddressExplorerTransfers
} from '@/types';
import { getServerSideApiUrlWithPath } from '../../../lib/api-url';
import { resolveVisitorForwardedFor } from '../../../lib/resolveVisitorForwardedFor';

/** Each section's read, started together so they run in parallel. None of them rejects. */
export interface IAddressExplorerServerReads {
    profile: Promise<AddressExplorerSection<IAddressExplorerSpanSections['profile']>>;
    counterparties: Promise<AddressExplorerSection<IAddressExplorerSpanSections['counterparties']>>;
    transfers: Promise<AddressExplorerSection<IAddressExplorerTransfers>>;
    delegations: Promise<AddressExplorerSection<IAddressExplorerSpanSections['delegations']>>;
    permissions: Promise<AddressExplorerSection<IAddressExplorerSpanSections['permissions']>>;
}

/**
 * Fetch one section from the backend and read it out of the response body.
 *
 * Never rejects: a failed request becomes a failed section, so the page
 * renders that section's error with a retry instead of breaking. A 429 from
 * the rate limit is reported as `busy`, because trying again shortly fixes it.
 *
 * @param url - The backend URL of the section.
 * @param field - The response body field holding the section.
 * @param outbound - The headers to send: the visitor's cookie and address.
 * @returns The section, read or failed.
 */
async function readSectionOnServer<T>(
    url: string,
    field: 'section' | 'transfers',
    outbound: Record<string, string>
): Promise<AddressExplorerSection<T>> {
    let section: AddressExplorerSection<T> = { status: 'error', reason: 'failed' };
    try {
        const response = await fetch(url, { headers: outbound, cache: 'no-store' });
        if (response.ok) {
            const body = await response.json() as Partial<Record<typeof field, AddressExplorerSection<T>>>;
            section = body[field] ?? section;
        } else {
            const reason: AddressExplorerErrorReason = response.status === 429 ? 'busy' : 'failed';
            section = { status: 'error', reason };
        }
    } catch {
        section = { status: 'error', reason: 'failed' };
    }
    return section;
}

/**
 * Start every section's read for the address page, without waiting for any.
 *
 * @param address - The base58 address the page is about, already validated.
 * @param period - The span the span sections are read over.
 * @returns The reads in progress; the caller awaits each where its section renders.
 */
export async function startAddressExplorerReads(address: string, period: AddressExplorerPeriod): Promise<IAddressExplorerServerReads> {
    const requestHeaders = await headers();
    const cookie = requestHeaders.get('cookie');
    const forwardedFor = resolveVisitorForwardedFor(requestHeaders);
    const outbound: Record<string, string> = {};
    if (cookie) {
        outbound.Cookie = cookie;
    }
    if (forwardedFor) {
        outbound['x-forwarded-for'] = forwardedFor;
    }
    const base = `${getServerSideApiUrlWithPath()}/address-explorer/${encodeURIComponent(address)}`;

    /**
     * Start the read of one span section over the page's span.
     *
     * @param name - The section to read.
     * @returns The section's read in progress.
     */
    const readSpan = <K extends AddressExplorerSpanSection>(name: K) =>
        readSectionOnServer<IAddressExplorerSpanSections[K]>(`${base}/sections/${name}?period=${period}`, 'section', outbound);

    return {
        profile: readSpan('profile'),
        counterparties: readSpan('counterparties'),
        transfers: readSectionOnServer<IAddressExplorerTransfers>(`${base}/transfers`, 'transfers', outbound),
        delegations: readSpan('delegations'),
        permissions: readSpan('permissions')
    };
}
