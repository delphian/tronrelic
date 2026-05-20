/**
 * Lazy-loaded wrapper around the menu icon resolver.
 *
 * `MenuNavClient` renders on every page, so importing the full
 * `lucide-react` namespace from a `'use client'` module would inflate the
 * main bundle by ~1 MB. `next/dynamic({ ssr: false })` defers the import
 * to a separate chunk that loads the first time a menu icon needs to
 * render. Hydration stays clean — the server and the first client render
 * both produce an empty placeholder; the resolved glyph swaps in
 * post-hydration alongside any other live-updates dispatch.
 */
'use client';

import dynamic from 'next/dynamic';

const MenuNodeIconLoader = dynamic(() => import('./MenuNodeIconLoader'), { ssr: false });

interface MenuNodeIconProps {
    name: string;
    size?: number;
    className?: string;
}

export function MenuNodeIcon(props: MenuNodeIconProps) {
    return <MenuNodeIconLoader {...props} />;
}
