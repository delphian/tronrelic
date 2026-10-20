/**
 * @fileoverview Page-view tracker.
 *
 * Mounted once near the root (in `providers.tsx`), it watches the App Router
 * pathname and fires a page-view beacon on the initial mount and on every
 * navigation — capturing both hard loads and client-side soft navigations. It
 * renders nothing, so there is no SSR/hydration surface.
 *
 * Bots that do not run JavaScript never mount this, so the `page` event stream
 * it feeds is naturally interactive-traffic-only; the cookieless first-touch
 * (`bootstrap`) stream still captures them server-side via the middleware.
 *
 * A visitor who has not allowed analytics is counted anonymously instead,
 * through the consent module, so the traffic beacon never runs for them and
 * nothing ties their page views together.
 */

'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { sendPageView } from '../../lib/pageBeacon';
// Direct imports avoid pulling the consent module's component CSS via its barrel.
import { useConsent } from '../../../consent/hooks/useConsent';
import { sendAnonymousPageView } from '../../../consent/lib/sendAnonymousPageView';

/**
 * Emits a page-view beacon whenever the pathname changes (and on first mount).
 *
 * @returns Always `null` — this component renders no DOM.
 */
export function PageViewTracker(): null {
    const pathname = usePathname();
    const { state } = useConsent();
    const analytics = state.analytics;
    // Guard against firing twice for the same path: React StrictMode double-runs
    // effects in dev, an unrelated re-render must not re-beacon, and a visitor
    // changing their consent on a page must not count that page a second time.
    const lastPath = useRef<string | null>(null);

    useEffect(() => {
        if (pathname && lastPath.current !== pathname) {
            lastPath.current = pathname;
            if (analytics) {
                sendPageView(pathname);
            } else {
                sendAnonymousPageView();
            }
        }
    }, [pathname, analytics]);

    return null;
}
