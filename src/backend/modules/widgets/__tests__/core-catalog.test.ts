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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { WidgetsService } from '../widgets.service.js';
import { ZoneRegistry } from '../zones/zone-registry.js';
import { WidgetTypeRegistry } from '../widget-types/widget-type-registry.js';
import { PlacementService } from '../placements/placement.service.js';
import { PlacementResolver } from '../placements/placement-resolver.js';
import { __resetKnownZonesForTests } from '../zones/define-zone.js';
import { __resetKnownWidgetTypesForTests } from '../widget-types/define-widget-type.js';
import { CORE_ZONE_DESCRIPTORS } from '../zones/descriptors.js';
import {
    CORE_WIDGET_TYPE_DESCRIPTORS,
    RAW_HTML_TYPE_ID
} from '../widget-types/core-widget-types.js';

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
 */
function buildWidgetsService(): { widgets: WidgetsService } {
    const logger = new MockLogger();
    const db = createMockDatabaseService();
    PlacementService.__resetForTests();
    PlacementService.setDependencies(db, logger);
    const placements = PlacementService.getInstance();
    const zones = new ZoneRegistry(logger);
    const types = new WidgetTypeRegistry(logger);
    const resolver = new PlacementResolver(placements, types, logger);
    WidgetsService.__resetForTests();
    WidgetsService.setDependencies(zones, types, placements, resolver, logger);
    return { widgets: WidgetsService.getInstance() };
}

beforeEach(() => {
    __resetKnownZonesForTests();
    __resetKnownWidgetTypesForTests();
});

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
});

describe('Core widget-type catalog (raw-html)', () => {
    it('registers as core-owned and exposes its config schema', () => {
        const { widgets } = buildWidgetsService();
        for (const descriptor of CORE_WIDGET_TYPE_DESCRIPTORS) {
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
        for (const descriptor of CORE_WIDGET_TYPE_DESCRIPTORS) {
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
