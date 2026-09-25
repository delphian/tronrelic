/**
 * @fileoverview Core "site logo" widget renderer.
 *
 * Renders the `core:site-logo` widget type: the site wordmark as a link to
 * the home page. It used to be fixed in the site header; as a widget an
 * operator places it from `/system/widgets` and sets its text there.
 *
 * The wordmark comes straight from the SSR `data` prop, so server and client
 * output are identical. The `'use client'` directive is required even though
 * this file calls no hooks: every widget is handed to the client component
 * `WidgetWithContext` as a prop, and only a client component reference can
 * cross that boundary (see `RawHtmlWidget.tsx`). It is still rendered on the
 * server.
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
 * backend module internals.
 */
interface ISiteLogoData {
    /** The wordmark to show. */
    text?: string;
}

/**
 * Site logo widget: the wordmark linking to the home page.
 *
 * @param props - Widget component props; only the SSR `data` is read.
 * @returns The logo link.
 */
export function SiteLogoWidget({ data }: IWidgetComponentProps) {
    const { text = 'TronRelic' } = (data ?? {}) as ISiteLogoData;

    return (
        <Link href="/" className={styles.logo}>
            {text}
        </Link>
    );
}
