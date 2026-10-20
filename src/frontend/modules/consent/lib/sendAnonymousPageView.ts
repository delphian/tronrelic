/**
 * @fileoverview Count a page view without identifying the visitor.
 *
 * Used instead of the traffic beacon when the visitor has not allowed
 * analytics. It sends nothing but whether the browser reports automation, so
 * the backend can only add one to the day's count; the path, the referrer,
 * and the per-tab history the traffic beacon keeps are never read or stored.
 *
 * @module modules/consent/lib/sendAnonymousPageView
 */

import { getRuntimeConfig } from '../../../lib/runtimeConfig';
import { sendJsonBeacon } from '../../../lib/sendJsonBeacon';
import { isAutomatedBrowser } from '../../../lib/isAutomatedBrowser';

/**
 * Send one anonymous page view. Best-effort: any failure is swallowed so
 * counting never interferes with navigation.
 */
export function sendAnonymousPageView(): void {
    try {
        sendJsonBeacon(`${getRuntimeConfig().apiUrl}/consent/pageviews`, { automated: isAutomatedBrowser() });
    } catch {
        /* never throw into the navigation path */
    }
}
