/**
 * @fileoverview Resolves lucide-react icon name strings to React components.
 *
 * Menu nodes store icon identifiers as strings (e.g., 'Wrench', 'ArrowLeftRight').
 * This utility maps those strings to the corresponding lucide-react component
 * for rendering in the CategoryLandingPage card grid.
 *
 * Two callers today: `CategoryLandingPage` (server component) and
 * `MenuNodeIconLoader` (the `next/dynamic({ ssr: false })` chunk behind
 * `<MenuNodeIcon>`). The dynamic boundary keeps the lucide-react
 * namespace out of the main client bundle, so importing this resolver
 * from a `'use client'` module is only safe when the import is
 * lazy/code-split — direct imports from non-dynamic client modules will
 * regress bundle size.
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
    // Predicate mirrors `isRenderableLucideExport` in
    // `components/ui/IconPickerModal/IconPickerModal.tsx` so both surfaces
    // accept the same set: picker can never offer a name the resolver
    // would later reject (or vice versa). If the predicate is extended
    // there, mirror the change here.

    // Icon exports start with an uppercase letter; everything else
    // (e.g. `createLucideIcon`, `icons`) is a utility.
    if (!/^[A-Z]/.test(name)) {
        return undefined;
    }

    if (NON_ICON_EXPORTS.has(name) || name.startsWith('Lucide') || name.endsWith('Icon')) {
        return undefined;
    }

    const candidate = (LucideIcons as Record<string, unknown>)[name];

    // lucide-react ≥ 0.300 wraps every icon in `React.forwardRef(...)`, whose
    // result is a `ForwardRefExoticComponent` — `typeof` reports `'object'`,
    // not `'function'`. Accept both shapes: function components (legacy)
    // and exotic component objects (forwardRef / memo wrappers).
    if (candidate == null) {
        return undefined;
    }
    if (typeof candidate !== 'function' && typeof candidate !== 'object') {
        return undefined;
    }

    // Lucide icons carry a `displayName: string` set by `createLucideIcon`.
    // Non-component exports that happen to be objects (utility helpers,
    // future additions) will not, so requiring it closes the
    // non-renderable-cast risk Copilot flagged.
    const component = candidate as { displayName?: unknown };
    if (typeof component.displayName !== 'string') {
        return undefined;
    }

    return candidate as LucideIcon;
}
