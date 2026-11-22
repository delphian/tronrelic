/**
 * @fileoverview Server-side read of a CMS page's public metadata.
 */

import { getServerSideApiUrlWithPath } from '../../../lib/api-url';
import type { IPublicPageResponse } from '../types/IPublicPageResponse';
import { publicPageUrl } from './publicPageUrl';

/**
 * Fetch the metadata of the CMS page served at a slug in one language, for
 * search metadata and structured data.
 *
 * Cached by Next.js for 60 seconds, matching the render fetch, so a page a
 * curator approves appears within a minute. A failed connection is thrown,
 * not reported as "no page", so a caller can tell a backend outage from a
 * page that does not exist and avoid answering an outage with a 404.
 *
 * @param slug - The page path, such as `/about`.
 * @param language - The language being rendered.
 * @returns The page's metadata, or null when no page is served there in that
 *   language.
 * @throws When the backend cannot be reached.
 */
export async function fetchPublicPageMetadata(slug: string, language: string): Promise<IPublicPageResponse | null> {
    const response = await fetch(publicPageUrl(getServerSideApiUrlWithPath(), slug, language), {
        next: { revalidate: 60 }
    });
    const result: IPublicPageResponse | null = response.ok ? await response.json() : null;

    return result;
}
