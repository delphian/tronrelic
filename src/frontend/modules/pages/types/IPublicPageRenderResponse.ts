/**
 * @fileoverview Shape of the public CMS page render endpoint's answer.
 */

import type { IWidgetData } from '@/types';

/**
 * What `GET /api/pages/:slug/render` returns: the sanitized HTML body and the
 * data for the widgets it embeds.
 */
export interface IPublicPageRenderResponse {
    html: string;
    /**
     * One widget data entry per embedded-widget placeholder in `html`, in
     * document order; null where an embed was skipped. Absent from a backend
     * older than embedded widgets, which renders the body without them.
     */
    embeds?: Array<IWidgetData | null>;
    metadata: {
        title: string;
        description?: string;
        keywords?: string[];
        ogImage?: string;
    };
    /** The page's current slug, which a request for an old slug should redirect to. */
    currentSlug: string;
    /** The slug the request asked for. */
    requestedSlug: string;
}
