/**
 * @fileoverview Options a caller passes to the shared markdown renderer.
 *
 * Callers render markdown into different page layouts, and a few layouts need
 * the HTML adjusted to fit. Each adjustment is an option on the one shared
 * pipeline, so no caller has to keep its own copy of that pipeline to get it.
 */

/**
 * Adjustments to the HTML the shared markdown renderer produces.
 */
export interface IMarkdownRenderOptions {
    /**
     * Shift every heading in the body down one level (h1 becomes h2, and so on
     * up to h5 becoming h6; h6 stays h6).
     *
     * Set it when the page already renders its own title as the only `<h1>`,
     * such as a blog post. A markdown body that opens with `# Heading` would
     * otherwise add a second `<h1>`, which breaks the document outline for
     * screen readers and search engines. Defaults to false.
     */
    demoteHeadings?: boolean;
}
