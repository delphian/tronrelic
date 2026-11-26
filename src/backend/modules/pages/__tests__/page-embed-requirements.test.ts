/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for PageEmbedRequirements and the required-embed markup.
 *
 * A page built around one plugin's widget must disappear while that plugin is
 * disabled and come back when it is enabled again, so the gate is asked on
 * every read and must follow the widgets service as it changes.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { encodeWidgetEmbed, listRequiredWidgetTypes, parseWidgetEmbed, WIDGET_EMBED_MARKUP } from '@/types';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { PageEmbedRequirements } from '../services/page-embed-requirements.js';

/** Logger whose calls the tests can inspect. */
function createLogger(): ISystemLogService {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ISystemLogService;
}

/** One placeholder as the markdown renderer stores it. */
function placeholder(embed: unknown): string {
    const encoded = encodeURIComponent(JSON.stringify(embed));
    return `<${WIDGET_EMBED_MARKUP.tagName} ${WIDGET_EMBED_MARKUP.embedAttribute}="${encoded}"></${WIDGET_EMBED_MARKUP.tagName}>`;
}

describe('required widget embeds', () => {
    it('keeps required only when it is exactly true', () => {
        expect(parseWidgetEmbed({ type: 'a:b', required: true })).toEqual({ type: 'a:b', config: {}, required: true });
        expect(parseWidgetEmbed({ type: 'a:b', required: 'true' })).toEqual({ type: 'a:b', config: {} });
        expect(parseWidgetEmbed({ type: 'a:b', required: false })).toEqual({ type: 'a:b', config: {} });
    });

    /** HTML cached before the flag existed must decode the same as before. */
    it('writes required into the placeholder only when set', () => {
        expect(decodeURIComponent(encodeWidgetEmbed({ type: 'a:b', config: {} }))).toBe('{"type":"a:b","config":{}}');
        expect(decodeURIComponent(encodeWidgetEmbed({ type: 'a:b', config: {}, required: true }))).toBe('{"type":"a:b","config":{},"required":true}');
    });

    it('lists each required type once and ignores optional embeds', () => {
        const html = `<p>Intro</p>${placeholder({ type: 'x:dash', config: {}, required: true })}`
            + `${placeholder({ type: 'x:other', config: {} })}${placeholder({ type: 'x:dash', config: {}, required: true })}`;

        expect(listRequiredWidgetTypes(html)).toEqual(['x:dash']);
    });
});

describe('PageEmbedRequirements', () => {
    const requiredHtml = `<p>Intro</p>${placeholder({ type: 'whale-alerts:dashboard', config: {}, required: true })}`;

    it('serves a page with no required embed without consulting the widgets service', () => {
        const registry = createMockServiceRegistry({});
        const gate = new PageEmbedRequirements(registry, createLogger());

        expect(gate.isServable(`<p>Plain</p>${placeholder({ type: 'gone:type', config: {} })}`)).toBe(true);
    });

    it('withholds a page while its required type is unregistered and serves it once registered', () => {
        const registered = new Set<string>();
        const registry = createMockServiceRegistry({ widgets: { hasType: (id: string) => registered.has(id) } });
        const gate = new PageEmbedRequirements(registry, createLogger());

        expect(gate.isServable(requiredHtml)).toBe(false);
        registered.add('whale-alerts:dashboard');
        expect(gate.isServable(requiredHtml)).toBe(true);
    });

    it('withholds a page with a required embed when the widgets service is missing', () => {
        const logger = createLogger();
        const gate = new PageEmbedRequirements(createMockServiceRegistry({}), logger);

        expect(gate.isServable(requiredHtml)).toBe(false);
        expect(logger.warn).toHaveBeenCalled();
    });
});
