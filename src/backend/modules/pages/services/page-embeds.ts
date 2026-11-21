/**
 * @fileoverview Fetches the data for widgets embedded in a rendered page.
 *
 * A page body can embed widgets with ` ```widget ` blocks, which the markdown
 * renderer stores as placeholders. The public render endpoints send each
 * placeholder's current widget data beside the cached HTML, so the page can
 * render the widgets on the server without the HTML cache holding data that
 * goes stale.
 *
 * The widgets module publishes `'widgets'` in its `run()`, after this module
 * has initialized, so the service is looked up on each call rather than
 * received at init. Requests only arrive after startup, when it is present.
 */

import type { IServiceRegistry, ISystemLogService, IWidgetData, IWidgetsService } from '@/types';

/**
 * Resolves a page body's embedded widgets for the public render endpoints.
 */
export class PageEmbeds {
    /**
     * @param serviceRegistry - Where the widgets service is looked up per call.
     * @param logger - Records the case where the widgets service is missing.
     */
    constructor(
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Fetch the data for every widget embedded in a rendered page body.
     *
     * Returns an empty list when the widgets service is unavailable; the
     * frontend treats a missing entry like a skipped embed and renders
     * nothing in its place, so the page itself still renders.
     *
     * @param html - The page's rendered, sanitized HTML.
     * @param slug - The page's current slug, which is the route fetchers see.
     * @param language - The language the page is rendered in.
     * @returns One entry per placeholder, in document order.
     */
    async resolve(html: string, slug: string, language: string): Promise<Array<IWidgetData | null>> {
        let result: Array<IWidgetData | null> = [];
        const widgets = this.serviceRegistry.get<IWidgetsService>('widgets');
        if (widgets) {
            result = await widgets.resolveEmbeds(html, {
                route: slug,
                params: { slug: slug.replace(/^\//, '') },
                language
            });
        } else {
            this.logger.warn({ slug }, 'Widgets service unavailable; embedded widgets on this page are not rendered');
        }
        return result;
    }
}
