/**
 * @fileoverview Renders a page or post body with its embedded widgets in place.
 *
 * The shared markdown renderer stores a body as sanitized HTML in which each
 * ` ```widget ` block became an empty placeholder, and the content endpoint
 * sends one widget data entry per placeholder beside it. This component cuts
 * the HTML at the placeholders with `splitWidgetEmbeds` and renders each HTML
 * run as markup and each placeholder as its widget, so the whole body,
 * widgets included, arrives in the server HTML.
 *
 * - No `'use client'` and no hooks: it renders in the CMS page's server tree
 *   and, through the plugin context, inside a plugin's client page.
 * - The caller's typography class goes on each HTML run, not on the outer
 *   element. Body stylesheets use descendant rules such as `.body p` and
 *   `.body a`, which would otherwise reach into a widget and restyle its
 *   paragraphs and links. Each run is `display: contents`, so it adds no box
 *   and still passes the class's inherited properties to its children; a
 *   `:first-child` rule now also matches the first element after an embed.
 * - A placeholder with no data (skipped, failed, or past the per-body limit)
 *   renders nothing.
 */

import { splitWidgetEmbeds, type IEmbeddedContentProps } from '@/types';
import { WidgetRenderer } from './WidgetRenderer';
import { cn } from '../../lib/cn';
import styles from './EmbeddedWidgetContent.module.scss';

/**
 * Props for the embedded-widget body renderer: the published
 * `IEmbeddedContentProps`, so the core component and the one plugins receive
 * as `context.ui.EmbeddedContent` take exactly the same props.
 */
export type IEmbeddedWidgetContentProps = IEmbeddedContentProps;

/** Shared empty params so a widget's props keep one identity across renders. */
const NO_PARAMS: Record<string, string> = {};

/**
 * Render a body with its embedded widgets.
 *
 * @param props - See {@link IEmbeddedWidgetContentProps}.
 * @returns The body element.
 */
export function EmbeddedWidgetContent({ html, embeds = [], route, params = NO_PARAMS, className }: IEmbeddedWidgetContentProps) {
    const segments = splitWidgetEmbeds(html);
    const htmlClass = cn(styles.html, className);
    return (
        <div className={styles.root}>
            {segments.map((segment, position) => {
                if (segment.kind === 'html') {
                    // Safe: sanitized by the shared markdown renderer before it was stored.
                    return <div key={`html-${position}`} className={htmlClass} dangerouslySetInnerHTML={{ __html: segment.html }} />;
                }
                const widget = embeds[segment.index] ?? null;
                return widget ? (
                    <div key={`embed-${segment.index}`} className={styles.embed} data-widget-id={widget.id} data-plugin-id={widget.pluginId}>
                        <WidgetRenderer widget={widget} route={route} params={params} />
                    </div>
                ) : null;
            })}
        </div>
    );
}
