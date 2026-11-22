/**
 * @fileoverview Server-side read of a CMS page's rendered body.
 */

import { getServerSideApiUrlWithPath } from '../../../lib/api-url';
import type { IPublicPageRenderResponse } from '../types/IPublicPageRenderResponse';
import { publicPageUrl } from './publicPageUrl';

/**
 * Fetch the rendered HTML and embedded-widget data of the CMS page served at a
 * slug in one language.
 *
 * Cached by Next.js for 60 seconds, so a page a curator approves appears
 * within a minute and its embeds resolve at most once a minute per frontend
 * instance. A failed connection is thrown, not reported as "no page", so a
 * caller can tell a backend outage from a page that does not exist.
 *
 * @param slug - The page path, such as `/about`.
 * @param language - The language being rendered.
 * @returns The rendered page, or null when no page is served there in that
 *   language.
 * @throws When the backend cannot be reached.
 */
export async function fetchPublicPageRender(slug: string, language: string): Promise<IPublicPageRenderResponse | null> {
    const response = await fetch(publicPageUrl(getServerSideApiUrlWithPath(), slug, language, '/render'), {
        next: { revalidate: 60 }
    });
    const result: IPublicPageRenderResponse | null = response.ok ? await response.json() : null;

    return result;
}
