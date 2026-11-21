/// <reference types="vitest" />

/**
 * @fileoverview Tests for the resolver that fetches data for widgets embedded
 * in page and post bodies.
 *
 * Embeds are written by page authors, who include AI tools and other
 * non-curators, so these tests pin the checks that run before any fetcher:
 * the type must be registered and embeddable, the settings must pass the
 * type's schema, and a body cannot start more than the per-body limit of
 * fetches.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { ISystemLogService, IWidgetEmbed, WidgetDataFetcher } from '@/types';
import { encodeWidgetEmbed } from '@/types';
import { EmbedResolver, EMBED_ZONE, MAX_EMBEDS_PER_BODY } from '../embeds/embed-resolver.js';
import { InstanceConfigValidator } from '../widget-types/instance-config-validator.js';
import { WidgetTypeRegistry } from '../widget-types/widget-type-registry.js';
import { defineWidgetType, __resetKnownWidgetTypesForTests } from '../widget-types/define-widget-type.js';

/** Logger double whose calls the tests can inspect. */
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

/** Build the placeholder the markdown renderer writes for one embed. */
function placeholder(embed: IWidgetEmbed): string {
    return `<tr-widget data-embed="${encodeWidgetEmbed(embed)}" data-type="${embed.type}"></tr-widget>`;
}

describe('EmbedResolver', () => {
    let logger: ISystemLogService;
    let registry: WidgetTypeRegistry;
    let resolver: EmbedResolver;
    let clockFetcher: Mock<WidgetDataFetcher>;

    beforeEach(() => {
        __resetKnownWidgetTypesForTests();
        logger = createLogger();
        registry = new WidgetTypeRegistry(logger);
        clockFetcher = vi.fn<WidgetDataFetcher>(async (_route, _params, placement) => ({
            zones: placement?.instanceConfig.zones
        }));
        registry.register('core', defineWidgetType({
            id: 'core:clocks',
            label: 'Clocks',
            description: '',
            defaultDataFetcher: clockFetcher,
            configSchema: {
                type: 'object',
                properties: { zones: { type: 'array', items: { type: 'string' }, maxItems: 3 } },
                additionalProperties: false
            }
        }));
        registry.register('core', defineWidgetType({
            id: 'core:raw',
            label: 'Raw',
            description: '',
            defaultDataFetcher: vi.fn(async () => ({ html: '<b>x</b>' })),
            embeddable: false
        }));
        resolver = new EmbedResolver(registry, new InstanceConfigValidator(logger), logger);
    });

    it('fetches each embed with its settings and the page context, in placeholder order', async () => {
        const html = `<p>a</p>${placeholder({ type: 'core:clocks', config: { zones: ['UTC'] } })}<p>b</p>`;
        const results = await resolver.resolve(html, { route: '/about', params: { slug: 'about' }, language: 'zh' });

        expect(results).toEqual([{
            id: 'core:clocks',
            zone: EMBED_ZONE,
            pluginId: 'core',
            order: 0,
            data: { zones: ['UTC'] },
            instanceConfig: { zones: ['UTC'] }
        }]);
        expect(clockFetcher).toHaveBeenCalledWith('/about', { slug: 'about' }, {
            id: 'embed-0',
            instanceConfig: { zones: ['UTC'] },
            language: 'zh'
        });
    });

    it('returns null for a type that does not allow embedding, without running its fetcher', async () => {
        const results = await resolver.resolve(placeholder({ type: 'core:raw', config: {} }), { route: '/' });
        expect(results).toEqual([null]);
    });

    it('returns null for an unregistered type', async () => {
        const results = await resolver.resolve(placeholder({ type: 'gone:widget', config: {} }), { route: '/' });
        expect(results).toEqual([null]);
    });

    it('returns null when the settings fail the type schema, without running the fetcher', async () => {
        const html = placeholder({ type: 'core:clocks', config: { zones: ['a', 'b', 'c', 'd'] } });
        const results = await resolver.resolve(html, { route: '/' });
        expect(results).toEqual([null]);
        expect(clockFetcher).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('keeps one result per placeholder so a skipped embed does not shift the ones after it', async () => {
        const html = placeholder({ type: 'core:raw', config: {} }) + placeholder({ type: 'core:clocks', config: {} });
        const results = await resolver.resolve(html, { route: '/' });
        expect(results).toHaveLength(2);
        expect(results[0]).toBeNull();
        expect(results[1]).toMatchObject({ id: 'core:clocks', order: 1 });
    });

    it('stops fetching past the per-body limit', async () => {
        const one = placeholder({ type: 'core:clocks', config: {} });
        const results = await resolver.resolve(one.repeat(MAX_EMBEDS_PER_BODY + 2), { route: '/' });
        expect(results).toHaveLength(MAX_EMBEDS_PER_BODY + 2);
        expect(results.slice(MAX_EMBEDS_PER_BODY)).toEqual([null, null]);
        expect(clockFetcher).toHaveBeenCalledTimes(MAX_EMBEDS_PER_BODY);
    });

    it('returns an empty list for a body with no embeds', async () => {
        expect(await resolver.resolve('<p>plain</p>', { route: '/' })).toEqual([]);
    });
});
