/**
 * @fileoverview The one markdown-to-HTML pipeline the platform uses.
 *
 * CMS pages and blog posts both inject rendered markdown with
 * `dangerouslySetInnerHTML`, which is safe only because the HTML has been
 * sanitized first. Keeping the pipeline in one service means the sanitize rules,
 * and any later change such as support for embedded widgets, apply to every
 * surface at once instead of to whichever copy someone remembered to update.
 *
 * Pipeline: remark with GitHub Flavored Markdown converts markdown to HTML with
 * raw HTML kept, then rehype-sanitize cleans the whole result, so raw HTML in the
 * markdown is cleaned too. Optional adjustments run after sanitizing.
 */

import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { rehype } from 'rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { IMarkdownRendererService, IMarkdownRenderOptions, ISystemLogService } from '@/types';
import { rehypeDemoteHeadings } from '../lib/rehypeDemoteHeadings.js';

/** Collaborators wired once at bootstrap. */
export interface IMarkdownRendererServiceDependencies {
    /** Logger scoped to the markdown module, which records render failures. */
    logger: ISystemLogService;
}

/**
 * Singleton implementing `IMarkdownRendererService`.
 *
 * Singleton because it is the published renderer every module and plugin
 * shares: configured once at bootstrap and consumed by all callers.
 */
export class MarkdownRendererService implements IMarkdownRendererService {
    private static instance: MarkdownRendererService | null = null;

    private readonly logger: ISystemLogService;

    /**
     * Private so construction only happens through `setDependencies`.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    private constructor(deps: IMarkdownRendererServiceDependencies) {
        this.logger = deps.logger;
    }

    /**
     * Configure the singleton. The first call wins, so a second caller cannot
     * replace the instance other components already hold.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    public static setDependencies(deps: IMarkdownRendererServiceDependencies): void {
        if (!MarkdownRendererService.instance) {
            MarkdownRendererService.instance = new MarkdownRendererService(deps);
        }
    }

    /**
     * Return the configured singleton.
     *
     * @returns The shared renderer.
     * @throws If `setDependencies` has not run.
     */
    public static getInstance(): MarkdownRendererService {
        if (!MarkdownRendererService.instance) {
            throw new Error('MarkdownRendererService.setDependencies() must be called before getInstance()');
        }
        return MarkdownRendererService.instance;
    }

    /**
     * Drop the singleton so each test builds a fresh service against its own
     * mocks.
     */
    public static resetForTests(): void {
        MarkdownRendererService.instance = null;
    }

    /**
     * Render markdown to sanitized HTML.
     *
     * Sanitizing runs on the complete HTML, after conversion, because remark
     * keeps raw HTML from the markdown as written. Heading demotion runs after
     * sanitizing, so it only ever renames tags the sanitizer already allowed.
     * A failure is logged here, where the module's Logs view records it, and
     * then thrown to the caller, which decides what the failure means.
     *
     * @param markdown - The markdown body, without frontmatter.
     * @param options - Layout adjustments for the page the HTML goes into.
     * @returns The sanitized HTML.
     */
    async render(markdown: string, options: IMarkdownRenderOptions = {}): Promise<string> {
        try {
            const converted = await remark()
                .use(remarkGfm)
                .use(remarkHtml, { sanitize: false })
                .process(markdown);

            const processor = rehype().use(rehypeSanitize);
            if (options.demoteHeadings) {
                processor.use(rehypeDemoteHeadings);
            }
            const sanitized = await processor.use(rehypeStringify).process(String(converted));

            return String(sanitized);
        } catch (error) {
            this.logger.error({ error, markdownLength: markdown.length }, 'Markdown render failed');
            throw error;
        }
    }
}
