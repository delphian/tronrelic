/// <reference types="vitest" />

/**
 * @fileoverview Tests for the shared markdown renderer: GitHub Flavored
 * Markdown output, the sanitize step that makes the HTML safe to inject, the
 * heading-demotion option, and the singleton contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
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
});
