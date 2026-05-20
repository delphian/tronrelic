/**
 * Inner icon renderer for `<MenuNodeIcon>`.
 *
 * Imported only through `next/dynamic` in `MenuNodeIcon.tsx`, so the
 * `lucide-react` namespace import sits in a separate chunk that loads on
 * the first menu render rather than ballooning the initial bundle. The
 * resolver itself is shared with `CategoryLandingPage` for identical
 * name-resolution behavior across surfaces.
 */
'use client';

import { resolveIcon } from '../../../modules/menu/components/CategoryLandingPage/iconResolver';

interface MenuNodeIconLoaderProps {
    name: string;
    size?: number;
    className?: string;
}

/**
 * Render the lucide icon for `name`, or nothing if it does not resolve.
 * Decorative by definition — the link/button's `aria-label` already
 * carries the accessible name, so the icon stays `aria-hidden`.
 */
export default function MenuNodeIconLoader({
    name,
    size = 16,
    className
}: MenuNodeIconLoaderProps) {
    const Icon = resolveIcon(name);
    if (!Icon) return null;
    return <Icon size={size} className={className} aria-hidden="true" />;
}
