/**
 * @fileoverview Resolves lucide-react icon name strings to React components.
 *
 * Menu nodes store icon identifiers as strings (e.g., 'Wrench', 'ArrowLeftRight').
 * This utility maps those strings to the corresponding lucide-react component
 * for rendering in the CategoryLandingPage card grid.
 *
 * Safe to use the full lucide-react namespace here because this file is only
 * imported by server components — the barrel import never reaches the client
 * bundle.
 */

import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Non-component exports from lucide-react that must not be rendered. */
const NON_ICON_EXPORTS = new Set(['icons', 'Icon', 'createLucideIcon']);

/**
 * Resolve a lucide-react icon name string to its component.
 *
 * Uses the full lucide-react export namespace for lookup. Returns undefined
 * if the name doesn't match a valid icon component, allowing callers to
 * fall back gracefully. Filters out known non-component exports and aliases
 * (LucideX, XIcon) to match the IconPickerModal's filtering logic.
 *
 * @param name - Icon name as stored in menu node (e.g., 'Wrench', 'Zap')
 * @returns The LucideIcon component or undefined if not found
 */
export function resolveIcon(name: string): LucideIcon | undefined {
    if (NON_ICON_EXPORTS.has(name) || name.startsWith('Lucide') || name.endsWith('Icon')) {
        return undefined;
    }

    const candidate = (LucideIcons as Record<string, unknown>)[name];

    if (typeof candidate !== 'function') {
        return undefined;
    }

    return candidate as LucideIcon;
}
