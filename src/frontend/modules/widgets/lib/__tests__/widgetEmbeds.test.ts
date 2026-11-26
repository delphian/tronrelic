/// <reference types="vitest" />

/**
 * Tests for the embedded-widget text formats the frontend relies on.
 *
 * The Insert widget dialog writes a ` ```widget ` block, and the CMS page and
 * blog post pages cut stored HTML at its placeholders. These tests pin both:
 * the block must carry exactly the embed the author chose, on its own lines,
 * and splitting must keep HTML runs intact and number placeholders in order,
 * because that number is how each one is paired with its widget data.
 */

import { describe, it, expect } from 'vitest';
import { encodeWidgetEmbed, parseWidgetEmbed, splitWidgetEmbeds, WIDGET_EMBED_MARKUP } from '@/types';
import { formatWidgetEmbedBlock } from '../formatWidgetEmbedBlock';

/** Build a placeholder exactly as the markdown renderer writes it. */
function placeholder(type: string, config: Record<string, unknown>): string {
    return `<tr-widget data-embed="${encodeWidgetEmbed({ type, config })}" data-type="${type}"></tr-widget>`;
}

describe('formatWidgetEmbedBlock', () => {
    it('writes a fenced widget block whose body parses back to the embed', () => {
        const block = formatWidgetEmbedBlock({ type: 'core:world-clocks', config: { zones: ['UTC'] } });
        const match = /```widget\n([\s\S]*?)\n```/.exec(block);
        expect(match).not.toBeNull();
        expect(parseWidgetEmbed(JSON.parse(match![1]))).toEqual({ type: 'core:world-clocks', config: { zones: ['UTC'] } });
    });

    it('writes required only when the author switched it on', () => {
        const required = formatWidgetEmbedBlock({ type: 'x:dash', config: {}, required: true });
        const optional = formatWidgetEmbedBlock({ type: 'x:dash', config: {} });

        expect(parseWidgetEmbed(JSON.parse(/```widget\n([\s\S]*?)\n```/.exec(required)![1]))).toEqual({ type: 'x:dash', config: {}, required: true });
        expect(optional).not.toContain('required');
    });

    it('surrounds the block with blank lines so it stays a top-level block', () => {
        const block = formatWidgetEmbedBlock({ type: 'core:world-clocks', config: {} });
        expect(block.startsWith('\n\n')).toBe(true);
        expect(block.endsWith('\n\n')).toBe(true);
        expect(block).toContain(`\`\`\`${WIDGET_EMBED_MARKUP.fenceLanguage}\n`);
    });
});

describe('splitWidgetEmbeds', () => {
    it('returns one HTML segment for a body with no embeds', () => {
        expect(splitWidgetEmbeds('<p>a</p>')).toEqual([{ kind: 'html', html: '<p>a</p>' }]);
    });

    it('returns no segments for an empty body', () => {
        expect(splitWidgetEmbeds('')).toEqual([]);
    });

    it('numbers placeholders in order and keeps the HTML between them', () => {
        const html = `<p>a</p>${placeholder('x:one', {})}${placeholder('x:two', { n: 1 })}<p>b</p>`;
        expect(splitWidgetEmbeds(html)).toEqual([
            { kind: 'html', html: '<p>a</p>' },
            { kind: 'embed', index: 0, embed: { type: 'x:one', config: {} } },
            { kind: 'embed', index: 1, embed: { type: 'x:two', config: { n: 1 } } },
            { kind: 'html', html: '<p>b</p>' }
        ]);
    });

    it('keeps the numbering when a placeholder cannot be decoded', () => {
        const html = `<tr-widget data-embed="%7Bbroken"></tr-widget>${placeholder('x:two', {})}`;
        expect(splitWidgetEmbeds(html)).toEqual([
            { kind: 'embed', index: 0, embed: null },
            { kind: 'embed', index: 1, embed: { type: 'x:two', config: {} } }
        ]);
    });
});

describe('parseWidgetEmbed', () => {
    it('fills in empty settings and drops other keys', () => {
        expect(parseWidgetEmbed({ type: 'x:one', extra: true })).toEqual({ type: 'x:one', config: {} });
    });

    it('refuses a value without a usable type or with non-object settings', () => {
        expect(parseWidgetEmbed({ config: {} })).toBeNull();
        expect(parseWidgetEmbed({ type: '<script>', config: {} })).toBeNull();
        expect(parseWidgetEmbed({ type: 'x:one', config: [] })).toBeNull();
        expect(parseWidgetEmbed('x:one')).toBeNull();
    });
});
