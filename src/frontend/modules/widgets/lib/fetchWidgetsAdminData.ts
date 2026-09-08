/**
 * @fileoverview Server-side data fetch for `/system/widgets`.
 *
 * Runs inside the Next.js server during render so the editor's first paint
 * carries real zones, widget types, placements, and the site's page list.
 * The admin endpoints are cookie-gated, so the visitor's cookies are
 * forwarded; the menu read is public and gated per node.
 *
 * Only `page.tsx` imports this file. It reaches into `next/headers`, which
 * is server-only, so it is deliberately kept out of the module's client
 * barrel and exposed through `modules/widgets/server` instead.
 *
 * @module modules/widgets/lib/fetchWidgetsAdminData
 */

import { cookies } from 'next/headers';
import type { MenuNodeSerialized } from '@/shared';
import type { IWidgetPlacement, IWidgetTypeSnapshot, IZoneSnapshot } from '@/types';
import { getServerSideApiUrl } from '../../../lib/api-url';
import { pageOptionsFromMenu } from './pageOptions';
import type { IWidgetsAdminData } from '../types/IWidgetsAdminData';

/**
 * Fetch one JSON endpoint with the visitor's cookies attached, throwing a
 * readable error on a non-2xx status so the caller can report which of the
 * four loads failed.
 *
 * @param path - Backend path beginning with `/api/`.
 * @param cookieHeader - The serialised request cookies, possibly empty.
 * @param what - Short noun for the error message.
 * @returns The parsed JSON body.
 */
async function fetchJson<T>(path: string, cookieHeader: string, what: string): Promise<T> {
    const response = await fetch(`${getServerSideApiUrl()}${path}`, {
        cache: 'no-store',
        headers: cookieHeader ? { Cookie: cookieHeader } : undefined
    });
    if (!response.ok) {
        throw new Error(`Could not load ${what} (${response.status})`);
    }
    return response.json() as Promise<T>;
}

/**
 * Fetch a menu namespace tree, returning an empty tree on any failure so a
 * menu outage never blocks the editor. The tab row and the page list both
 * refill on the next live `menu:update` or client refetch.
 *
 * @param namespace - The menu namespace to read.
 * @param cookieHeader - The serialised request cookies.
 * @returns The namespace's root nodes and snapshot timestamp.
 */
export async function fetchMenuNamespace(
    namespace: string,
    cookieHeader: string
): Promise<{ roots: MenuNodeSerialized[]; generatedAt: string }> {
    const fallback = { roots: [] as MenuNodeSerialized[], generatedAt: new Date().toISOString() };
    let result = fallback;
    try {
        const data = await fetchJson<{ tree?: { roots?: MenuNodeSerialized[]; generatedAt?: string } }>(
            `/api/menu?namespace=${encodeURIComponent(namespace)}`,
            cookieHeader,
            `the ${namespace} menu`
        );
        result = {
            roots: data.tree?.roots ?? [],
            generatedAt: data.tree?.generatedAt ?? fallback.generatedAt
        };
    } catch {
        result = fallback;
    }
    return result;
}

/**
 * Load everything the editor renders on first paint. A failure in any of
 * the admin loads is reported through `loadError` rather than thrown, so
 * the page still renders its frame and offers a retry instead of a Next.js
 * error boundary.
 *
 * @returns The seed data for the client shell.
 */
export async function fetchWidgetsAdminData(): Promise<IWidgetsAdminData> {
    const cookieHeader = (await cookies()).toString();
    const data: IWidgetsAdminData = { zones: null, types: null, placements: [], pages: [], loadError: null };

    const menu = await fetchMenuNamespace('main', cookieHeader);
    data.pages = pageOptionsFromMenu(menu.roots);

    try {
        const [zones, types, placementsBody] = await Promise.all([
            fetchJson<IZoneSnapshot>('/api/admin/system/zones', cookieHeader, 'zones'),
            fetchJson<IWidgetTypeSnapshot>('/api/admin/system/widget-types', cookieHeader, 'widget types'),
            fetchJson<{ placements?: IWidgetPlacement[] }>('/api/admin/system/widgets/placements', cookieHeader, 'placements')
        ]);
        data.zones = zones;
        data.types = types;
        data.placements = placementsBody.placements ?? [];
    } catch (error) {
        data.loadError = error instanceof Error ? error.message : String(error);
    }

    return data;
}
