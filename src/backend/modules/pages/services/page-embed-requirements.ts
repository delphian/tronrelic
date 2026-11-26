/**
 * @fileoverview Decides whether a page may be served, given its required embeds.
 *
 * An author marks a ` ```widget ` block `"required": true` when the page makes
 * no sense without it, such as a page built around one plugin's dashboard.
 * While that widget type is unregistered, usually because its plugin is
 * disabled, the page is treated as missing: its address answers 404, and it
 * leaves the sitemap and the public page tools. When the plugin is enabled
 * again the page comes back by itself, because nothing is stored; the check
 * runs on every public read.
 *
 * The check reads the rendered HTML, so the cached render of a page is
 * checked as well as a fresh one.
 */

import type { IServiceRegistry, ISystemLogService, IWidgetsService } from '@/types';
import { listRequiredWidgetTypes } from '@/types';

/**
 * The question the page services ask before serving a page. Declared as an
 * interface so the page services can be tested without a widgets service.
 */
export interface IPageServingGate {
    /**
     * Whether a page with this rendered body may be served.
     *
     * @param html - The page's rendered, sanitized HTML.
     * @returns False while any widget type the body marks required is unregistered.
     */
    isServable(html: string): boolean;
}

/**
 * Looks each required widget type up on the `'widgets'` service.
 *
 * The widgets module publishes that service in its `run()`, after the pages
 * module has initialized, so it is looked up on each call. Requests only
 * arrive after startup, when it is present. If it is ever missing, a page
 * with a required embed is withheld: the embed would render as nothing, which
 * is the outcome `required` exists to prevent. A page with no required embed
 * is served either way.
 */
export class PageEmbedRequirements implements IPageServingGate {
    /**
     * @param serviceRegistry - Where the widgets service is looked up per call.
     * @param logger - Records a page withheld because the widgets service is missing.
     */
    constructor(
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /** @inheritdoc */
    isServable(html: string): boolean {
        const required = listRequiredWidgetTypes(html);
        let servable = true;
        if (required.length > 0) {
            const widgets = this.serviceRegistry.get<IWidgetsService>('widgets');
            if (!widgets) {
                this.logger.warn({ required }, 'Widgets service unavailable; a page with required embeds is withheld');
                servable = false;
            } else {
                servable = required.every((typeId) => widgets.hasType(typeId));
            }
        }

        return servable;
    }
}

/**
 * A gate that serves every page, for callers with no widgets to check, such
 * as tests of the page services that do not exercise embeds.
 */
export const SERVE_EVERY_PAGE: IPageServingGate = {
    /**
     * Serve the page whatever it embeds.
     *
     * @returns Always true.
     */
    isServable: () => true
};
