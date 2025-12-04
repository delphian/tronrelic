/**
 * @file icon-lookup.ts
 * @description Utility for looking up Lucide icon path data by name.
 *
 * This module provides server-side icon lookup to avoid bundling all ~1,867
 * Lucide icons on the frontend. The frontend receives pre-resolved SVG path
 * data for theme icons, eliminating the 562KB lucide-react bundle from pages.
 */

import * as icons from 'lucide';

/**
 * SVG element definition as exported by lucide package.
 * Each tuple contains [elementType, attributes].
 *
 * @example
 * ["circle", { cx: "12", cy: "12", r: "4" }]
 * ["path", { d: "M12 2v2" }]
 */
export type IconElement = [string, Record<string, string>];

/**
 * Array of SVG elements that compose an icon.
 */
export type IconNode = IconElement[];

/**
 * Retrieve the SVG elements for a Lucide icon by name.
 *
 * @param iconName - PascalCase icon name (e.g., "Sun", "Moon", "Monitor")
 * @returns Array of [elementType, attributes] tuples or null if not found
 *
 * @example
 * const sunIcon = getIconNode('Sun');
 * // Returns: [["circle", { cx: "12", cy: "12", r: "4" }], ["path", { d: "M12 2v2" }], ...]
 */
export function getIconNode(iconName: string): IconNode | null {
    if (!iconName) return null;

    // Cast through unknown because lucide exports include non-icon members like 'default'
    const iconsRecord = icons as unknown as Record<string, IconNode | undefined>;

    // Try exact name first (e.g., "Sun", "Moon")
    let icon = iconsRecord[iconName];

    // If not found, strip "Icon" suffix (lucide-react uses "SunIcon", lucide uses "Sun")
    if (!icon && iconName.endsWith('Icon')) {
        const baseName = iconName.slice(0, -4);
        icon = iconsRecord[baseName];
    }

    if (!icon || !Array.isArray(icon)) {
        return null;
    }

    return icon;
}

/**
 * Check if an icon name exists in the Lucide icon set.
 *
 * @param iconName - PascalCase icon name to validate
 * @returns True if the icon exists, false otherwise
 *
 * @example
 * isValidIconName('Sun')     // true
 * isValidIconName('FakeIcon') // false
 */
export function isValidIconName(iconName: string): boolean {
    return getIconNode(iconName) !== null;
}

/**
 * Convert icon node data to a serializable format for API responses.
 *
 * The icon node is already JSON-serializable, but this function provides
 * a clear API boundary and type safety for the serialization process.
 *
 * @param iconNode - Icon node from getIconNode()
 * @returns JSON-serializable icon data or null
 */
export function serializeIconNode(iconNode: IconNode | null): IconNode | null {
    if (!iconNode) return null;
    return iconNode;
}
