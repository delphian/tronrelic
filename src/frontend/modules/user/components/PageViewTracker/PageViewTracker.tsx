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
 */

'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { sendPageView } from '../../lib/pageBeacon';

/**
 * Emits a page-view beacon whenever the pathname changes (and on first mount).
 *
 * @returns Always `null` — this component renders no DOM.
 */
export function PageViewTracker(): null {
    const pathname = usePathname();
    // Guard against firing twice for the same path: React StrictMode double-runs
    // effects in dev, and an unrelated re-render must not re-beacon.
    const lastPath = useRef<string | null>(null);

    useEffect(() => {
        if (!pathname || lastPath.current === pathname) {
            return;
        }
        lastPath.current = pathname;
        sendPageView(pathname);
    }, [pathname]);

    return null;
}
