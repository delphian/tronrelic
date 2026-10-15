/**
 * @fileoverview Guard layout for every page under the `[lang]` segment.
 *
 * The middleware rewrites each page request into the `[lang]` folder and
 * records the language it chose. A few requests are deliberately left
 * unrewritten so public files can be served, such as `/images/logo.png`. When
 * such a file does not exist, Next.js still matches the request to this folder
 * and treats `images` as the language. Without this guard, `/images/about`
 * would render the About page.
 *
 * Throwing `notFound()` here, one level below the root layout, lets the
 * `[lang]/not-found.tsx` boundary render the site's usual 404 page inside the
 * normal header and footer, exactly as an unknown URL did before the move.
 */

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { resolveRequestLanguage } from '../../../modules/localization/server';

/**
 * Render the page only when the middleware routed the request to this language.
 *
 * @param props - The page subtree and the `[lang]` route params.
 * @returns The page subtree unchanged.
 */
export default async function SiteLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
    const { lang } = await params;
    const { routed } = await resolveRequestLanguage(lang);
    if (!routed) {
        notFound();
    }
    return <>{children}</>;
}
