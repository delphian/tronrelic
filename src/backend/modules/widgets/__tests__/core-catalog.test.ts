/// <reference types="vitest" />

/**
 * @fileoverview Tests for the core widget catalog — the footer zone and
 * the `core:raw-html` widget type that ship out of the box.
 *
 * Guards the contract `WidgetsModule.run()` depends on: the footer zone
 * descriptor exists and the raw-html type registers as `'core'`-owned,
 * carries its config schema into the admin snapshot, and resolves its
 * SSR payload straight from the placement's `instanceConfig`. Mirrors
 * the wiring in `widgets.service.test.ts` so the registration path is
 * exercised for real rather than stubbed.
 *
 * @module backend/modules/widgets/__tests__/core-catalog.test
 */

import { describe, it, expect, vi } from 'vitest';
import type { ISystemConfig, ISystemConfigService, ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { WidgetsService } from '../widgets.service.js';
import { ZoneRegistry } from '../zones/zone-registry.js';
import { WidgetTypeRegistry } from '../widget-types/widget-type-registry.js';
import { PlacementService } from '../placements/placement.service.js';
import { PlacementResolver } from '../placements/placement-resolver.js';
import { WidgetRouteCache } from '../placements/WidgetRouteCache.js';
import { ZoneLayoutService } from '../zones/zone-layout.service.js';
import { __resetKnownZonesForTests } from '../zones/define-zone.js';
import { __resetKnownWidgetTypesForTests } from '../widget-types/define-widget-type.js';
import { CORE_ZONE_DESCRIPTORS } from '../zones/descriptors.js';
import {
    AUTH_BUTTON_TYPE_ID,
    buildCoreWidgetTypeDescriptors,
    MAIN_MENU_TYPE_ID,
    RAW_HTML_TYPE_ID,
    SITE_LOGO_TYPE_ID
} from '../widget-types/core-widget-types.js';

/**
 * Core widget-type descriptors built over a mock service registry. The
 * block-ticker fetcher resolves `'blockchain'` from the registry at fetch
 * time; an empty mock registry returns undefined, which the fetcher
 * handles by yielding `{ block: null }`. The raw-html assertions below
 * never exercise the ticker, so the empty registry is sufficient.
 */
const coreWidgetTypeDescriptors = buildCoreWidgetTypeDescriptors({
    serviceRegistry: createMockServiceRegistry(),
    systemConfig: buildSystemConfig(async () => ({ authButtonImageUrl: '/uploads/sign-in.png' }))
});

/**
 * Build a system-config stub whose `getConfig` answers with the given
 * function. Only `getConfig` is read by the catalog, through the
 * auth-button fetcher, so nothing else is implemented.
 *
 * @param getConfig - What the auth-button fetcher will receive.
 * @returns The stub, typed as the full service the catalog expects.
 */
function buildSystemConfig(getConfig: () => Promise<Partial<ISystemConfig>>): ISystemConfigService {
    return { getConfig } as unknown as ISystemConfigService;
}

/**
 * Minimal `ISystemLogService` stub — every method is a spy/no-op so the
 * registration path can log freely without a backing store.
 */
class MockLogger implements ISystemLogService {
    public level = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_b: Record<string, unknown>): ISystemLogService => this);
    public async initialize() {}
    public async saveLog() {}
    public async getLogs() {
        return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }
    public async markAsResolved() {}
    public async cleanup() { return 0; }
    public async getStatistics() { return { total: 0, byLevel: {} as any, byService: {}, unresolved: 0 }; }
    public async getLogById() { return null; }
    public async markAsUnresolved() { return null; }
    public async deleteAllLogs() { return 0; }
    public async getStats() { return { total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 }; }
    public async waitUntilInitialized() {}
}

/**
 * Build a fully wired WidgetsService over fresh collaborators, mirroring
 * `WidgetsModule.init()`.
 *
 * Each call stands for a fresh process, so it also clears the
 * process-wide sets of minted zone and widget-type ids. Without that, a
 * test that builds the service twice would register `site-top` a second
 * time and trip the duplicate-id guard in `defineZone`.
 *
 * @returns The wired service, ready for zones and types to be registered.
 */
function buildWidgetsService(): { widgets: WidgetsService } {
    __resetKnownZonesForTests();
    __resetKnownWidgetTypesForTests();
    const logger = new MockLogger();
    const db = createMockDatabaseService();
    PlacementService.__resetForTests();
    PlacementService.setDependencies(db, logger);
    const placements = PlacementService.getInstance();
    const zones = new ZoneRegistry(logger);
    const types = new WidgetTypeRegistry(logger);
    const resolver = new PlacementResolver(placements, types, logger);
    ZoneLayoutService.__resetForTests();
    ZoneLayoutService.setDependencies(db, logger);
    const zoneLayouts = ZoneLayoutService.getInstance();
    WidgetsService.__resetForTests();
    WidgetsService.setDependencies(zones, types, placements, resolver, new WidgetRouteCache(), zoneLayouts, logger);
    return { widgets: WidgetsService.getInstance() };
}

describe('Core zone catalog', () => {
    it('declares a site-host footer zone', () => {
        const footer = CORE_ZONE_DESCRIPTORS.find(z => z.id === 'footer');
        expect(footer).toBeDefined();
        expect(footer?.host).toBe('site');
    });

    it('registers the footer zone through the public service', () => {
        const { widgets } = buildWidgetsService();
        for (const descriptor of CORE_ZONE_DESCRIPTORS) {
            widgets.registerZone(descriptor, 'core');
        }
        expect(widgets.hasZone('footer')).toBe(true);
    });

    it('declares a site-host site-top zone above the header zone', () => {
        // The zone only does its job if it sorts ahead of 'ticker-after',
        // because the editor track is what tells an operator which zone is
        // the top of the page. `order: 0` is also the case a truthiness
        // check on the field would silently drop.
        const siteTop = CORE_ZONE_DESCRIPTORS.find(z => z.id === 'site-top');
        expect(siteTop).toBeDefined();
        expect(siteTop?.host).toBe('site');
        expect(siteTop?.order).toBe(0);
    });

    it('orders site-track zones by descriptor order, not alphabetically', () => {
        // Regression guard: the site track must read page top-to-bottom —
        // site-top, then the header zone, then the footer. The previous
        // alphabetical snapshot sort put 'footer' ahead of 'ticker-after'.
        const { widgets } = buildWidgetsService();
        for (const descriptor of CORE_ZONE_DESCRIPTORS) {
            widgets.registerZone(descriptor, 'core');
        }
        const siteTrack = widgets.listZones().tracks.find(track => track.id === 'site');
        expect(siteTrack?.zones.map(zone => zone.id)).toEqual(['site-top', 'ticker-after', 'footer']);
    });
});

describe('Core widget-type catalog (raw-html)', () => {
    it('registers as core-owned and exposes its config schema', () => {
        const { widgets } = buildWidgetsService();
        for (const descriptor of coreWidgetTypeDescriptors) {
            widgets.registerType(descriptor, 'core');
        }

        expect(widgets.hasType(RAW_HTML_TYPE_ID)).toBe(true);
        const schema = widgets.getTypeConfigSchema(RAW_HTML_TYPE_ID);
        expect(schema?.required).toContain('content');

        const record = widgets.listTypes().groups
            .flatMap(g => g.types)
            .find(t => t.id === RAW_HTML_TYPE_ID);
        expect(record?.pluginId).toBe('core');
    });

    it('resolves SSR payload from the placement instance config', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone(
            CORE_ZONE_DESCRIPTORS.find(z => z.id === 'footer')!,
            'core'
        );
        for (const descriptor of coreWidgetTypeDescriptors) {
            widgets.registerType(descriptor, 'core');
        }

        await widgets.createPlacement({
            typeId: RAW_HTML_TYPE_ID,
            zoneId: 'footer',
            routes: [],
            instanceConfig: { content: '<p>hi</p>', mode: 'html' }
        });

        const resolved = await widgets.fetchWidgetsForRoute('/');
        const widget = resolved.find(w => w.id === RAW_HTML_TYPE_ID);
        expect(widget?.zone).toBe('footer');
        expect(widget?.data).toEqual({ content: '<p>hi</p>', mode: 'html' });
    });
});

describe('Core widget-type catalog (auth-button)', () => {
    /**
     * Resolve the auth-button's SSR payload from a catalog built over the
     * given system configuration, through a real placement in the
     * `site-top` zone.
     *
     * @param getConfig - What the system configuration answers.
     * @returns The widget data the resolver produced, or undefined when the
     *          widget was dropped.
     */
    async function resolveAuthButton(getConfig: () => Promise<Partial<ISystemConfig>>): Promise<unknown> {
        const { widgets } = buildWidgetsService();
        widgets.registerZone(CORE_ZONE_DESCRIPTORS.find(z => z.id === 'site-top')!, 'core');
        const descriptors = buildCoreWidgetTypeDescriptors({
            serviceRegistry: createMockServiceRegistry(),
            systemConfig: buildSystemConfig(getConfig)
        });
        for (const descriptor of descriptors) {
            widgets.registerType(descriptor, 'core');
        }
        await widgets.createPlacement({ typeId: AUTH_BUTTON_TYPE_ID, zoneId: 'site-top', routes: [] });
        const resolved = await widgets.fetchWidgetsForRoute('/');
        return resolved.find(w => w.id === AUTH_BUTTON_TYPE_ID)?.data;
    }

    it('carries the administrator\'s sign-in image', async () => {
        await expect(resolveAuthButton(async () => ({ authButtonImageUrl: '/uploads/sign-in.png' })))
            .resolves.toEqual({ imageUrl: '/uploads/sign-in.png' });
    });

    it('falls back to the text button when no image is set', async () => {
        await expect(resolveAuthButton(async () => ({ authButtonImageUrl: null })))
            .resolves.toEqual({ imageUrl: null });
        await expect(resolveAuthButton(async () => ({})))
            .resolves.toEqual({ imageUrl: null });
    });

    it('still renders when the configuration cannot be read (auth-button)', async () => {
        // A missing widget would leave the site with no way to sign in, so a
        // failed read degrades to the text button instead of dropping it.
        await expect(resolveAuthButton(async () => { throw new Error('database down'); }))
            .resolves.toEqual({ imageUrl: null });
    });
});

describe('Core widget-type catalog (site-logo, main-menu)', () => {
    /**
     * Resolve one core widget's SSR payload through a real placement in the
     * `site-top` zone.
     *
     * @param typeId - The core widget type to place.
     * @param instanceConfig - The placement's operator config, if any.
     * @returns The widget data the resolver produced.
     */
    async function resolveCoreWidget(typeId: string, instanceConfig?: Record<string, unknown>): Promise<unknown> {
        const { widgets } = buildWidgetsService();
        widgets.registerZone(CORE_ZONE_DESCRIPTORS.find(z => z.id === 'site-top')!, 'core');
        for (const descriptor of coreWidgetTypeDescriptors) {
            widgets.registerType(descriptor, 'core');
        }
        await widgets.createPlacement({ typeId, zoneId: 'site-top', routes: [], ...(instanceConfig ? { instanceConfig } : {}) });
        const resolved = await widgets.fetchWidgetsForRoute('/');
        return resolved.find(w => w.id === typeId)?.data;
    }

    it('shows the default wordmark until an operator sets one', async () => {
        await expect(resolveCoreWidget(SITE_LOGO_TYPE_ID)).resolves.toEqual({ text: 'TronRelic' });
        await expect(resolveCoreWidget(SITE_LOGO_TYPE_ID, { text: '   ' })).resolves.toEqual({ text: 'TronRelic' });
        await expect(resolveCoreWidget(SITE_LOGO_TYPE_ID, { text: ' Relic ' })).resolves.toEqual({ text: 'Relic' });
    });

    it('carries only the menu alignment, never the per-visitor menu items', async () => {
        // The items differ by visitor and this payload is cached per route,
        // so they must reach the component another way.
        await expect(resolveCoreWidget(MAIN_MENU_TYPE_ID)).resolves.toEqual({ align: 'flex-end' });
        await expect(resolveCoreWidget(MAIN_MENU_TYPE_ID, { align: 'center' })).resolves.toEqual({ align: 'center' });
    });
});
