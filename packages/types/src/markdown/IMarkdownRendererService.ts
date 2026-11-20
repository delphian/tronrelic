/**
 * @fileoverview Published contract for the shared markdown renderer.
 *
 * Every surface that turns authored markdown into HTML for visitors (CMS pages,
 * blog posts) needs the same rules: GitHub Flavored Markdown, and a sanitize
 * step that makes the HTML safe to inject with `dangerouslySetInnerHTML`. One
 * service owns those rules so a fix to them reaches every surface at once.
 *
 * The markdown module publishes it on the service registry as `'markdown'`.
 * Plugins resolve it from there, because they may not import core code.
 */

import type { IMarkdownRenderOptions } from './IMarkdownRenderOptions.js';

/**
 * Renders markdown to sanitized HTML.
 */
export interface IMarkdownRendererService {
    /**
     * Render markdown to HTML that is safe to inject into a page.
     *
     * The markdown is parsed with GitHub Flavored Markdown (tables,
     * strikethrough, task lists, autolinks). Sanitizing runs after the HTML is
     * produced, so raw HTML written inside the markdown is cleaned too: scripts,
     * event handler attributes, and other unsafe markup are removed.
     *
     * @param markdown - The markdown body, without a frontmatter block. Plain
     *   text is valid markdown, so a caller does not need to check the input
     *   format first.
     * @param options - Layout adjustments for the page the HTML goes into.
     * @returns The sanitized HTML.
     * @throws When the markdown cannot be processed. The caller decides whether
     *   that refuses a save or fails a request.
     */
    render(markdown: string, options?: IMarkdownRenderOptions): Promise<string>;
}
