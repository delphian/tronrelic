/**
 * @fileoverview Shared device-category icon helper for the analytics tables.
 *
 * Extracted so the first-touches table and the page-activity tables render the
 * same glyph for a given device category without duplicating the switch.
 */

import { Smartphone, Tablet, Monitor, HelpCircle } from 'lucide-react';

/** Default inline icon size for analytics table cells. */
const DEFAULT_DEVICE_ICON_SIZE = 14;

/**
 * Map a device-category string to its Lucide icon.
 *
 * @param device - Device category (`'mobile'` | `'tablet'` | `'desktop'` | other).
 * @param size - Icon pixel size.
 * @returns The icon element.
 */
export function getDeviceIcon(device: string, size: number = DEFAULT_DEVICE_ICON_SIZE): JSX.Element {
    switch (device) {
        case 'mobile': return <Smartphone size={size} aria-label="Mobile device" />;
        case 'tablet': return <Tablet size={size} aria-label="Tablet device" />;
        case 'desktop': return <Monitor size={size} aria-label="Desktop device" />;
        default: return <HelpCircle size={size} aria-label="Unknown device" />;
    }
}
