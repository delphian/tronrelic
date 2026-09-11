/**
 * @fileoverview Server-side read of the branding settings the site header needs.
 *
 * The header's sign-in button can be replaced by an image an administrator
 * picks on `/system/system`. That setting cannot ride on `getServerConfig()`,
 * because that config is fetched once and kept for the life of the container,
 * so a newly saved image would not appear until the frontend restarted. This
 * reads `/api/config/branding` on every server render instead. The backend
 * answers from an in-memory cache that it clears on every save, so the cost
 * per page is one small local request.
 *
 * Only call this from server components.
 */

import type { IBrandingConfig } from '@/types';
import { getServerSideApiUrl } from '../../../lib/api-url';

/** What the header renders when no image is set or the backend cannot be reached. */
const DEFAULT_BRANDING: IBrandingConfig = { authButtonImageUrl: null };

/** How long the header waits for the backend before rendering the default button. */
const BRANDING_TIMEOUT_MS = 3000;

/**
 * Fetch the header's branding settings for the current server render.
 *
 * Any failure — the backend is down, slow, or returns something unexpected —
 * falls back to the default text button rather than throwing. The header is on
 * every page, so a branding problem must never stop a page from rendering.
 *
 * @returns The branding settings, or the defaults when they could not be read.
 */
export async function fetchHeaderBranding(): Promise<IBrandingConfig> {
    let branding: IBrandingConfig = DEFAULT_BRANDING;

    try {
        const response = await fetch(`${getServerSideApiUrl()}/api/config/branding`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(BRANDING_TIMEOUT_MS)
        });

        if (response.ok) {
            const data = await response.json() as { branding?: Partial<IBrandingConfig> };
            const url = data.branding?.authButtonImageUrl;

            branding = { authButtonImageUrl: typeof url === 'string' && url !== '' ? url : null };
        }
    } catch {
        branding = DEFAULT_BRANDING;
    }

    return branding;
}
