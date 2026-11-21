/**
 * @fileoverview Props for the component that renders a markdown body with its
 * embedded widgets.
 *
 * A plugin that shows rendered markdown, such as the blog's post page,
 * receives the component as `context.ui.EmbeddedContent` and passes it the
 * stored HTML and the widget data its endpoint returned beside it.
 */

import type { IWidgetData } from '../widget/IWidgetData.js';

/**
 * Props for `context.ui.EmbeddedContent`.
 */
export interface IEmbeddedContentProps {
    /** Sanitized HTML from the shared markdown renderer. */
    html: string;
    /**
     * One entry per embedded-widget placeholder in `html`, in document
     * order, as `IWidgetsService.resolveEmbeds` returned it. A null or
     * missing entry renders nothing in that placeholder's place.
     */
    embeds?: ReadonlyArray<IWidgetData | null>;
    /** The page path, passed to each widget component. */
    route: string;
    /** The page's route params, passed to each widget component. */
    params?: Record<string, string>;
    /**
     * The body's typography class. It is applied to each run of body HTML
     * rather than to an outer element, so descendant rules such as
     * `.body p` and `.body a` style the prose and never reach into an
     * embedded widget. Put layout styles such as a width on a parent instead.
     */
    className?: string;
}
