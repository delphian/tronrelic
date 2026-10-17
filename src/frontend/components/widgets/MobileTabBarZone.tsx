/**
 * @fileoverview Render site for the Mobile tab bar zone.
 *
 * The zone holds phone navigation fixed to the bottom of the screen. Fixing
 * it takes it out of the page flow, so the last lines of every page would sit
 * underneath it; this component therefore also renders a spacer at the end of
 * the page with the bar's height. Both show only on phone-sized screens.
 *
 * When no widget is placed in the zone, nothing renders at all, neither the
 * bar nor the spacer, so the site looks exactly as it did before the zone
 * existed. That is what makes the tab bar opt-in: an operator turns it on by
 * placing the Tab bar widget here from `/system/widgets`.
 *
 * @module frontend/components/widgets/MobileTabBarZone
 */

import type { IZoneLayoutConfig } from '@/types';
import type { WidgetData } from './types';
import { WidgetZone } from './WidgetZone';
import styles from './MobileTabBarZone.module.scss';

/** Zone id, matching the descriptor in `backend/modules/widgets/zones/descriptors.ts`. */
export const MOBILE_TAB_BAR_ZONE_ID = 'mobile-tab-bar';

/**
 * Props for {@link MobileTabBarZone}.
 */
interface IMobileTabBarZoneProps {
    /** Every widget resolved for the route; the component picks out this zone's own. */
    widgets: WidgetData[];
    /** The zone's operator layout, from the same SSR bundle. */
    layout?: IZoneLayoutConfig;
    /** Current path, forwarded to the widgets. */
    route: string;
}

/**
 * Render the Mobile tab bar zone fixed to the bottom of the screen, plus the
 * spacer that keeps page content clear of it.
 *
 * @param props - The route's widgets, the zone layout, and the current path.
 * @returns The spacer and the fixed bar, or nothing when the zone is empty.
 */
export function MobileTabBarZone({ widgets, layout, route }: IMobileTabBarZoneProps) {
    const hasWidgets = widgets.some(widget => widget.zone === MOBILE_TAB_BAR_ZONE_ID);

    return hasWidgets ? (
        <>
            <div className={styles.spacer} aria-hidden="true" />
            <div className={styles.dock}>
                <WidgetZone name={MOBILE_TAB_BAR_ZONE_ID} widgets={widgets} layout={layout} route={route} params={{}} />
            </div>
        </>
    ) : null;
}
