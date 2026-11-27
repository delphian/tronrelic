/**
 * @fileoverview One step of a page's breadcrumb trail, as search engines read it.
 *
 * Breadcrumb structured data tells a search engine where a page sits in the
 * site, and Google shows the trail in place of the raw URL on desktop
 * results. The server works the trail out and the structured data builder
 * writes it, so both sides share this shape.
 */

/**
 * One step of a breadcrumb trail.
 */
export interface IBreadcrumbItem {
    /** The text shown for the step, in the page's language where a translation exists. */
    name: string;
    /** The absolute URL of the step, which must be a real page on the site. */
    url: string;
}
