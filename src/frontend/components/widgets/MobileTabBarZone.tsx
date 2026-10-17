/**
 * @fileoverview Render site for the Mobile tab bar zone.
 *
 * The zone holds phone navigation stuck to the bottom of the screen. The bar
 * stays in the page flow, so it reserves exactly the height it renders at and
 * the last lines of a page scroll clear of it however tall the bar gets. It
 * shows only on phone-sized screens.
 *
 * When no widget is placed in the zone, nothing renders at all, so the site
 * looks exactly as it did before the zone existed. That is what makes the tab bar opt-in: an operator turns it on by
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
 * Render the Mobile tab bar zone stuck to the bottom of the screen.
 *
 * The bar is the last element in the page flow, which lets one box both hold
 * the bar against the bottom of the viewport and reserve the space the bar
 * occupies, so no separate spacer has to guess its height.
 *
 * @param props - The route's widgets, the zone layout, and the current path.
 * @returns The bar, or nothing when the zone is empty.
 */
export function MobileTabBarZone({ widgets, layout, route }: IMobileTabBarZoneProps) {
    const hasWidgets = widgets.some(widget => widget.zone === MOBILE_TAB_BAR_ZONE_ID);

    return hasWidgets ? (
        <div className={styles.dock}>
            <WidgetZone name={MOBILE_TAB_BAR_ZONE_ID} widgets={widgets} layout={layout} route={route} params={{}} />
        </div>
    ) : null;
}
