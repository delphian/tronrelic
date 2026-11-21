/// <reference types="vitest" />

/**
 * @fileoverview Tests for the shared markdown renderer: GitHub Flavored
 * Markdown output, the sanitize step that makes the HTML safe to inject, the
 * embedded-widget placeholders, the heading-demotion option, and the
 * singleton contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { splitWidgetEmbeds } from '@/types';
import { MarkdownRendererService } from '../services/markdown-renderer.service.js';

/** Silent logger double; the renderer writes to it only when a render fails. */
function createLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

describe('MarkdownRendererService', () => {
    let logger: ISystemLogService;
    let renderer: MarkdownRendererService;

    beforeEach(() => {
        MarkdownRendererService.resetForTests();
        logger = createLogger();
        MarkdownRendererService.setDependencies({ logger });
        renderer = MarkdownRendererService.getInstance();
    });

    describe('singleton', () => {
        it('throws when read before it is configured', () => {
            MarkdownRendererService.resetForTests();
            expect(() => MarkdownRendererService.getInstance()).toThrow('setDependencies');
        });

        it('keeps the first configuration', () => {
            MarkdownRendererService.setDependencies({ logger: createLogger() });
            expect(MarkdownRendererService.getInstance()).toBe(renderer);
        });
    });

    describe('render()', () => {
        it('renders basic markdown', async () => {
            const html = await renderer.render('# Title\n\nSome **bold** text.');
            expect(html).toContain('<h1>Title</h1>');
            expect(html).toContain('<strong>bold</strong>');
        });

        it('renders GitHub Flavored Markdown tables and strikethrough', async () => {
            const html = await renderer.render('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~');
            expect(html).toContain('<table>');
            expect(html).toContain('<del>gone</del>');
        });

        it('removes script elements written as raw HTML', async () => {
            const html = await renderer.render('Before\n\n<script>alert(1)</script>\n\nAfter');
            expect(html).not.toContain('<script');
            expect(html).not.toContain('alert(1)');
            expect(html).toContain('After');
        });

        it('removes event handler attributes from raw HTML', async () => {
            const html = await renderer.render('<img src="/a.png" onerror="alert(1)">');
            expect(html).not.toContain('onerror');
        });

        it('removes javascript: link targets', async () => {
            const html = await renderer.render('[click](javascript:alert(1))');
            expect(html).not.toContain('javascript:');
        });

        // Pages and the blog write this HTML with dangerouslySetInnerHTML, so
        // the sanitizer is the only thing between stored text and a visitor's
        // browser. This case keeps a library upgrade or an options change from
        // letting executable or page-restyling markup through unnoticed.
        it('removes frames, inline styles, and executable markup together, keeping the harmless text', async () => {
            const markdown = [
                'Before <script>alert(0)</script> after',
                '<img src="x" onerror="alert(1)">',
                '[markdown link](javascript:alert(2))',
                '<a href="javascript:alert(3)">html link</a>',
                '<iframe src="https://example.com"></iframe>',
                '<div onclick="alert(4)" style="position:fixed">styled</div>'
            ].join('\n\n');

            const html = await renderer.render(markdown);

            expect(html).not.toMatch(/<script/i);
            expect(html).not.toMatch(/onerror|onclick/i);
            expect(html).not.toMatch(/javascript:/i);
            expect(html).not.toMatch(/<iframe/i);
            expect(html).not.toMatch(/style=/i);
            expect(html).not.toContain('alert(');
            expect(html).toContain('markdown link');
            expect(html).toContain('html link');
        });

        it('leaves headings at their written level by default', async () => {
            const html = await renderer.render('# One\n\n###### Six');
            expect(html).toContain('<h1>One</h1>');
            expect(html).toContain('<h6>Six</h6>');
        });

        it('demotes every heading one level when asked, keeping h6 as h6', async () => {
            const html = await renderer.render('# One\n\n## Two\n\n###### Six', { demoteHeadings: true });
            expect(html).toContain('<h2>One</h2>');
            expect(html).toContain('<h3>Two</h3>');
            expect(html).toContain('<h6>Six</h6>');
            expect(html).not.toContain('<h1>');
        });

        it('demotes headings nested inside other elements', async () => {
            const html = await renderer.render('> # Quoted', { demoteHeadings: true });
            expect(html).toContain('<h2>Quoted</h2>');
        });
    });

    describe('embedded widgets', () => {
        const block = '```widget\n{"type":"core:world-clocks","config":{"zones":["UTC"]}}\n```';

        it('turns a top-level widget block into a placeholder that splits back into the embed', async () => {
            const html = await renderer.render(`Before\n\n${block}\n\nAfter`);
            expect(html).not.toContain('<pre>');
            const segments = splitWidgetEmbeds(html);
            const embeds = segments.filter(segment => segment.kind === 'embed');
            expect(embeds).toEqual([
                { kind: 'embed', index: 0, embed: { type: 'core:world-clocks', config: { zones: ['UTC'] } } }
            ]);
            expect(segments[0]).toMatchObject({ kind: 'html' });
            expect(segments[segments.length - 1]).toMatchObject({ kind: 'html' });
        });

        it('labels the placeholder with its type id for editor previews', async () => {
            const html = await renderer.render(block);
            expect(html).toContain('data-type="core:world-clocks"');
        });

        it('leaves a block with invalid JSON as a visible code block', async () => {
            const html = await renderer.render('```widget\n{not json}\n```');
            expect(html).toContain('<pre>');
            expect(splitWidgetEmbeds(html).some(segment => segment.kind === 'embed')).toBe(false);
        });

        it('leaves a widget block nested in a list as a code block, so splitting cannot break the list', async () => {
            const html = await renderer.render(`- item\n\n  ${block.split('\n').join('\n  ')}`);
            expect(html).toContain('<pre>');
            expect(splitWidgetEmbeds(html).some(segment => segment.kind === 'embed')).toBe(false);
        });

        it('removes a placeholder element an author writes by hand', async () => {
            const forged = '<tr-widget data-embed="%7B%22type%22%3A%22core%3Araw-html%22%7D"></tr-widget>';
            const html = await renderer.render(`Text\n\n${forged}`);
            expect(html).not.toContain('tr-widget');
        });

        it('drops keys other than type and config from the stored embed', async () => {
            const html = await renderer.render('```widget\n{"type":"core:world-clocks","extra":"<b>x</b>"}\n```');
            const embed = splitWidgetEmbeds(html).find(segment => segment.kind === 'embed');
            expect(embed).toEqual({ kind: 'embed', index: 0, embed: { type: 'core:world-clocks', config: {} } });
        });
    });
});
