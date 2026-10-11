/**
 * @fileoverview Core "site logo" widget renderer.
 *
 * Renders the `core:site-logo` widget type: the site wordmark, with an
 * optional image such as the site icon before it, as a link to the home
 * page. It used to be fixed in the site header; as a widget an operator
 * places it from `/system/widgets` and sets its text and image there.
 *
 * The wordmark and image come straight from the SSR `data` prop, so server
 * and client output are identical. The `'use client'` directive is required
 * even though this file calls no hooks: every widget is handed to the client
 * component `WidgetWithContext` as a prop, and only a client component
 * reference can cross that boundary (see `RawHtmlWidget.tsx`). It is still
 * rendered on the server.
 *
 * @module frontend/components/widgets/SiteLogoWidget
 */

'use client';

import Link from 'next/link';
import type { IWidgetComponentProps } from '@/types';
import styles from './SiteLogoWidget.module.scss';

/**
 * SSR payload shape produced by the `core:site-logo` data fetcher. Mirrors
 * `ISiteLogoWidgetData` in `backend/modules/widgets/widget-types/
 * core-widget-types.ts`; redeclared because the frontend cannot import
 * backend module internals. Every field is optional because a payload
 * cached before the image setting existed has only `text`.
 */
interface ISiteLogoData {
    /** The wordmark to show. */
    text?: string;
    /** Image drawn before the wordmark, or null for the wordmark alone. */
    imageUrl?: string | null;
}

/**
 * Site logo widget: the optional image and the wordmark, linking to the
 * home page.
 *
 * The image has empty alt text because the wordmark beside it already gives
 * the link its accessible name, and a screen reader would otherwise read the
 * site name twice.
 *
 * @param props - Widget component props; only the SSR `data` is read.
 * @returns The logo link.
 */
export function SiteLogoWidget({ data }: IWidgetComponentProps) {
    const { text = 'TronRelic', imageUrl = null } = (data ?? {}) as ISiteLogoData;

    return (
        <Link href="/" className={styles.logo}>
            {imageUrl && (
                // Plain <img> is the project's convention for uploaded images.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className={styles.image} />
            )}
            {text}
        </Link>
    );
}
