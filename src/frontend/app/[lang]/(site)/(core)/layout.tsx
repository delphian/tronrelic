import type { ReactNode } from 'react';
import { CorePageZones } from '../../../../components/widgets';

/**
 * Core layout with widget zone support.
 *
 * Lets plugins and operators place widgets above and below any page in the
 * `(core)` route group without modifying page code. The `main-before` and
 * `main-after` zones come from `CorePageZones`, which the catch-all route also
 * uses for menu category and markdown pages, so a placement behaves the same
 * whichever route serves the page.
 *
 * @param props - The page content the route group renders.
 * @returns The page wrapped in the two core widget zones.
 */
export default function CoreLayout({ children }: { children: ReactNode }) {
    return <CorePageZones>{children}</CorePageZones>;
}
