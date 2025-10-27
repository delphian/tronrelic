/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MarkdownService } from '../services/markdown.service.js';
import type { ICacheService } from '@tronrelic/types';

/**
 * Mock CacheService for testing Redis operations.
 */
class MockCacheService implements ICacheService {
    private cache = new Map<string, { value: any; ttl?: number }>();

    async get<T = any>(key: string): Promise<T | null> {
        const entry = this.cache.get(key);
        return entry ? entry.value : null;
    }

    async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        this.cache.set(key, { value, ttl });
    }

    async del(key: string): Promise<void> {
        this.cache.delete(key);
    }

    async keys(pattern: string): Promise<string[]> {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return Array.from(this.cache.keys()).filter(k => regex.test(k));
    }

    clear(): void {
        this.cache.clear();
    }
}

describe('MarkdownService', () => {
    let markdownService: MarkdownService;
    let mockCache: MockCacheService;

    beforeEach(() => {
        mockCache = new MockCacheService();
        markdownService = new MarkdownService(mockCache);
    });

    afterEach(() => {
        mockCache.clear();
    });

    // ============================================================================
    // Frontmatter Parsing Tests
    // ============================================================================

    describe('parseMarkdown', () => {
        it('should parse frontmatter from markdown content', () => {
            const content = `---
title: "Test Page"
slug: "/test-page"
description: "A test page"
keywords: ["test", "markdown"]
published: true
ogImage: "/images/test.png"
---
# Page Content

This is the body content.`;

            const { frontmatter, body } = markdownService.parseMarkdown(content);

            expect(frontmatter.title).toBe('Test Page');
            expect(frontmatter.slug).toBe('/test-page');
            expect(frontmatter.description).toBe('A test page');
            expect(frontmatter.keywords).toEqual(['test', 'markdown']);
            expect(frontmatter.published).toBe(true);
            expect(frontmatter.ogImage).toBe('/images/test.png');
            expect(body).toContain('# Page Content');
            expect(body).toContain('This is the body content.');
        });

        it('should handle missing optional fields', () => {
            const content = `---
title: "Minimal Page"
---
Content here`;

            const { frontmatter, body } = markdownService.parseMarkdown(content);

            expect(frontmatter.title).toBe('Minimal Page');
            expect(frontmatter.slug).toBeUndefined();
            expect(frontmatter.description).toBeUndefined();
            expect(frontmatter.keywords).toBeUndefined();
            expect(frontmatter.published).toBe(false); // Defaults to false
            expect(frontmatter.ogImage).toBeUndefined();
        });

        it('should handle content without frontmatter', () => {
            const content = `# Just Content

No frontmatter here.`;

            const { frontmatter, body } = markdownService.parseMarkdown(content);

            expect(frontmatter.title).toBeUndefined();
            expect(body).toBe(content);
        });

        it('should handle published as boolean correctly', () => {
            const publishedTrue = `---
title: "Published"
published: true
---
Content`;

            const publishedFalse = `---
title: "Not Published"
published: false
---
Content`;

            const publishedMissing = `---
title: "Missing Published"
---
Content`;

            expect(markdownService.parseMarkdown(publishedTrue).frontmatter.published).toBe(true);
            expect(markdownService.parseMarkdown(publishedFalse).frontmatter.published).toBe(false);
            expect(markdownService.parseMarkdown(publishedMissing).frontmatter.published).toBe(false);
        });

        it('should handle keywords as array', () => {
            const withArray = `---
title: "Test"
keywords: ["tag1", "tag2", "tag3"]
---
Content`;

            const withoutArray = `---
title: "Test"
keywords: "not-an-array"
---
Content`;

            const resultWithArray = markdownService.parseMarkdown(withArray);
            const resultWithoutArray = markdownService.parseMarkdown(withoutArray);

            expect(resultWithArray.frontmatter.keywords).toEqual(['tag1', 'tag2', 'tag3']);
            expect(resultWithoutArray.frontmatter.keywords).toBeUndefined();
        });

        it('should throw error on invalid frontmatter YAML', () => {
            const invalidYaml = `---
title: "Test
invalid: [unclosed
---
Content`;

            expect(() => markdownService.parseMarkdown(invalidYaml)).toThrow(
                'Failed to parse frontmatter'
            );
        });
    });

    // ============================================================================
    // Markdown Rendering Tests
    // ============================================================================

    describe('renderMarkdown', () => {
        it('should render basic markdown to HTML', async () => {
            const markdown = `# Hello World

This is a paragraph with **bold** and *italic* text.`;

            const html = await markdownService.renderMarkdown(markdown);

            expect(html).toContain('<h1>Hello World</h1>');
            expect(html).toContain('<strong>bold</strong>');
            expect(html).toContain('<em>italic</em>');
        });

        it('should render lists', async () => {
            const markdown = `## Shopping List

- Apples
- Bananas
- Oranges

### Ordered List

1. First
2. Second
3. Third`;

            const html = await markdownService.renderMarkdown(markdown);

            expect(html).toContain('<h2>Shopping List</h2>');
            expect(html).toContain('<ul>');
            expect(html).toContain('<li>Apples</li>');
            expect(html).toContain('<ol>');
            expect(html).toContain('<li>First</li>');
        });

        it('should render links', async () => {
            const markdown = `Check out [this link](https://example.com).`;

            const html = await markdownService.renderMarkdown(markdown);

            expect(html).toContain('<a href="https://example.com">this link</a>');
        });

        it('should render code blocks', async () => {
            const markdown = `Here's some code:

\`\`\`javascript
function hello() {
    console.log("Hello World");
}
\`\`\``;

            const html = await markdownService.renderMarkdown(markdown);

            expect(html).toContain('<code');
            expect(html).toContain('function hello()');
        });

        it('should render GitHub Flavored Markdown tables', async () => {
            const markdown = `| Name | Age |
|------|-----|
| John | 30  |
| Jane | 25  |`;

            const html = await markdownService.renderMarkdown(markdown);

            expect(html).toContain('<table>');
            expect(html).toContain('<th>Name</th>');
            expect(html).toContain('<td>John</td>');
        });

        it('should render strikethrough text', async () => {
            const markdown = `This is ~~strikethrough~~ text.`;

            const html = await markdownService.renderMarkdown(markdown);

            expect(html).toContain('<del>strikethrough</del>');
        });

        it('should sanitize potentially dangerous HTML', async () => {
            const markdown = `This has <script>alert('XSS')</script> dangerous content.`;

            const html = await markdownService.renderMarkdown(markdown);

            // Script tags should be removed or escaped by sanitizer
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('alert(');
        });

        it('should handle empty markdown', async () => {
            const html = await markdownService.renderMarkdown('');

            expect(html).toBe('');
        });
    });

    // ============================================================================
    // Caching Tests
    // ============================================================================

    describe('getCachedHtml', () => {
        it('should return cached HTML if exists', async () => {
            const slug = '/test-page';
            const cachedHtml = '<h1>Cached Content</h1>';

            await mockCache.set('page:html:/test-page', cachedHtml);

            const result = await markdownService.getCachedHtml(slug);

            expect(result).toBe(cachedHtml);
        });

        it('should return null if cache miss', async () => {
            const result = await markdownService.getCachedHtml('/not-cached');

            expect(result).toBeNull();
        });
    });

    describe('cacheHtml', () => {
        it('should cache HTML with correct key and TTL', async () => {
            const slug = '/my-page';
            const html = '<h1>Content</h1>';

            await markdownService.cacheHtml(slug, html);

            const cached = await mockCache.get('page:html:/my-page');
            expect(cached).toBe(html);

            // Verify TTL was set (24 hours = 86400 seconds)
            const cacheEntry = (mockCache as any).cache.get('page:html:/my-page');
            expect(cacheEntry.ttl).toBe(86400);
        });
    });

    describe('invalidateCache', () => {
        it('should remove cached HTML for a slug', async () => {
            const slug = '/test-page';
            await mockCache.set('page:html:/test-page', '<h1>Content</h1>');

            // Verify cache exists before invalidation
            let cached = await markdownService.getCachedHtml(slug);
            expect(cached).toBeDefined();

            // Invalidate cache
            await markdownService.invalidateCache(slug);

            // Verify cache was cleared
            cached = await markdownService.getCachedHtml(slug);
            expect(cached).toBeNull();
        });

        it('should not throw error when invalidating non-existent cache', async () => {
            await expect(markdownService.invalidateCache('/non-existent')).resolves.not.toThrow();
        });
    });

    // ============================================================================
    // Integration Tests (Parsing + Rendering)
    // ============================================================================

    describe('parseMarkdown + renderMarkdown integration', () => {
        it('should parse frontmatter and render body separately', async () => {
            const content = `---
title: "Integration Test"
published: true
---
# Main Content

This is **important** content.`;

            const { frontmatter, body } = markdownService.parseMarkdown(content);

            expect(frontmatter.title).toBe('Integration Test');
            expect(frontmatter.published).toBe(true);

            const html = await markdownService.renderMarkdown(body);

            expect(html).toContain('<h1>Main Content</h1>');
            expect(html).toContain('<strong>important</strong>');
            // Frontmatter should not appear in rendered HTML
            expect(html).not.toContain('Integration Test');
            expect(html).not.toContain('published: true');
        });

        it('should handle complex markdown with multiple elements', async () => {
            const content = `---
title: "Complex Page"
---
# Heading 1

## Heading 2

This is a paragraph with [a link](https://example.com).

- List item 1
- List item 2

\`\`\`javascript
console.log("code");
\`\`\`

| Col1 | Col2 |
|------|------|
| A    | B    |`;

            const { body } = markdownService.parseMarkdown(content);
            const html = await markdownService.renderMarkdown(body);

            expect(html).toContain('<h1>Heading 1</h1>');
            expect(html).toContain('<h2>Heading 2</h2>');
            expect(html).toContain('<a href="https://example.com">a link</a>');
            expect(html).toContain('<ul>');
            expect(html).toContain('<code');
            expect(html).toContain('<table>');
        });
    });
});
