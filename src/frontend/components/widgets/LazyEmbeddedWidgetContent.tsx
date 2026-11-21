'use client';

/**
 * @fileoverview The embedded-widget body renderer as plugins receive it.
 *
 * `context.ui.EmbeddedContent` is built into every plugin's context, which is
 * part of the client bundle on every page. Importing `EmbeddedWidgetContent`
 * there directly would pull every widget component into that bundle, and
 * would also close an import cycle, since a widget's own context comes from
 * the same module. Loading it lazily keeps it in its own chunk.
 *
 * - On the server the lazy module resolves before the HTML is sent, so the
 *   body and its widgets are in the server HTML.
 * - During hydration React keeps the server HTML until the chunk arrives.
 * - On a client-side navigation the fallback shows the body text without the
 *   widgets until the chunk arrives, so the article never flashes empty.
 */

import { lazy, Suspense } from 'react';
import { splitWidgetEmbeds, type IEmbeddedContentProps } from '@/types';
import { cn } from '../../lib/cn';
import styles from './EmbeddedWidgetContent.module.scss';

/** The full renderer, in its own chunk. */
const EmbeddedWidgetContentChunk = lazy(() =>
    import('./EmbeddedWidgetContent').then(mod => ({ default: mod.EmbeddedWidgetContent }))
);

/**
 * The body's HTML without its widgets, in the same wrapper structure, shown
 * while the renderer's chunk loads.
 *
 * @param props - The same props the full renderer receives.
 */
function HtmlOnly({ html, className }: IEmbeddedContentProps) {
    const htmlClass = cn(styles.html, className);
    return (
        <div className={styles.root}>
            {splitWidgetEmbeds(html).map((segment, position) => (segment.kind === 'html'
                // Safe: sanitized by the shared markdown renderer before it was stored.
                ? <div key={`html-${position}`} className={htmlClass} dangerouslySetInnerHTML={{ __html: segment.html }} />
                : null))}
        </div>
    );
}

/**
 * Render a body with its embedded widgets, loading the renderer on demand.
 *
 * @param props - See {@link IEmbeddedContentProps}.
 * @returns The body element.
 */
export function LazyEmbeddedWidgetContent(props: IEmbeddedContentProps) {
    return (
        <Suspense fallback={<HtmlOnly {...props} />}>
            <EmbeddedWidgetContentChunk {...props} />
        </Suspense>
    );
}
