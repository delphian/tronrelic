/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the placements admin controller.
 *
 * Drives `PlacementsController` against a mocked `IPlacementService`,
 * registry stubs, and Express request/response doubles. Verifies
 * input validation, status codes, registry lookups, and the
 * special-cases for plugin-source rows (delete refusal,
 * restore-defaults).
 *
 * @module backend/modules/widgets/__tests__/placements.controller
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
    ISystemLogService,
    IPlacementService,
    IWidgetPlacement,
    IZoneRegistry,
    IWidgetTypeRegistry
} from '@/types';
import type { Request, Response } from 'express';
import { PlacementsController } from '../api/placements.controller.js';
import type { IPluginRegistrationDefaults } from '../../../services/widget/widget.service.js';

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

function buildPlacement(overrides: Partial<IWidgetPlacement> = {}): IWidgetPlacement {
    return {
        id: overrides.id ?? 'abc',
        typeId: overrides.typeId ?? 'widget:type',
        zoneId: overrides.zoneId ?? 'main-after',
        routes: overrides.routes ?? ['/'],
        order: overrides.order ?? 100,
        title: overrides.title,
        instanceConfig: overrides.instanceConfig,
        enabled: overrides.enabled ?? true,
        source: overrides.source ?? 'operator',
        pluginId: overrides.pluginId,
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z'
    };
}

function buildResponse(): Response {
    const res: Partial<Response> = {};
    res.status = vi.fn(() => res as Response) as any;
    res.json = vi.fn(() => res as Response) as any;
    res.end = vi.fn(() => res as Response) as any;
    return res as Response;
}

function buildController(overrides: {
    placements?: Partial<IPlacementService>;
    zones?: Partial<IZoneRegistry>;
    widgetTypes?: Partial<IWidgetTypeRegistry>;
    getPluginDefault?: (pluginId: string, typeId: string) => IPluginRegistrationDefaults | null;
} = {}) {
    const placements = {
        list: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        restoreToPluginDefaults: vi.fn(),
        ensurePluginPlacement: vi.fn(),
        softDisableForPlugin: vi.fn(),
        findByRoute: vi.fn(),
        ...overrides.placements
    } as unknown as IPlacementService;

    const zones = {
        has: vi.fn(),
        snapshot: vi.fn(),
        register: vi.fn(),
        disposeForPlugin: vi.fn(),
        get: vi.fn(),
        ...overrides.zones
    } as unknown as IZoneRegistry;

    const widgetTypes = {
        has: vi.fn(),
        snapshot: vi.fn(),
        register: vi.fn(),
        disposeForPlugin: vi.fn(),
        get: vi.fn(),
        getOwnerPluginId: vi.fn(),
        ...overrides.widgetTypes
    } as unknown as IWidgetTypeRegistry;

    const controller = new PlacementsController({
        placements,
        zones,
        widgetTypes,
        getPluginDefault: overrides.getPluginDefault ?? (() => null),
        logger: new MockLogger()
    });

    return { controller, placements, zones, widgetTypes };
}

describe('PlacementsController.listPlacements', () => {
    it('returns placements with no filter', async () => {
        const { controller, placements } = buildController();
        (placements.list as ReturnType<typeof vi.fn>).mockResolvedValue([buildPlacement()]);

        const res = buildResponse();
        await controller.listPlacements({ query: {} } as Request, res);

        expect(placements.list).toHaveBeenCalledWith({});
        expect(res.json).toHaveBeenCalledWith({ success: true, placements: [expect.any(Object)] });
    });

    it('forwards every supported filter from the query string', async () => {
        const { controller, placements } = buildController();
        (placements.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        await controller.listPlacements(
            {
                query: {
                    zoneId: 'main-after',
                    pluginId: 'whale-alerts',
                    source: 'plugin',
                    enabledOnly: 'true'
                }
            } as unknown as Request,
            buildResponse()
        );

        expect(placements.list).toHaveBeenCalledWith({
            zoneId: 'main-after',
            pluginId: 'whale-alerts',
            source: 'plugin',
            enabledOnly: true
        });
    });

    it('ignores unrecognised source values', async () => {
        const { controller, placements } = buildController();
        (placements.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        await controller.listPlacements(
            { query: { source: 'bogus' } } as unknown as Request,
            buildResponse()
        );

        expect(placements.list).toHaveBeenCalledWith({});
    });
});

describe('PlacementsController.getPlacement', () => {
    it('returns 404 when the placement does not exist', async () => {
        const { controller, placements } = buildController();
        (placements.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const res = buildResponse();
        await controller.getPlacement({ params: { id: 'x' } } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns the placement when found', async () => {
        const { controller, placements } = buildController();
        const placement = buildPlacement({ id: 'abc' });
        (placements.findById as ReturnType<typeof vi.fn>).mockResolvedValue(placement);

        const res = buildResponse();
        await controller.getPlacement({ params: { id: 'abc' } } as unknown as Request, res);

        expect(res.json).toHaveBeenCalledWith({ success: true, placement });
    });
});

describe('PlacementsController.createPlacement', () => {
    it('rejects unknown widget-type ids with 400', async () => {
        const { controller, widgetTypes, zones } = buildController();
        (widgetTypes.has as ReturnType<typeof vi.fn>).mockReturnValue(false);
        (zones.has as ReturnType<typeof vi.fn>).mockReturnValue(true);

        const res = buildResponse();
        await controller.createPlacement(
            { body: { typeId: 'mystery', zoneId: 'main-after', routes: ['/'] } } as Request,
            res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('Unknown widget type id')
        }));
    });

    it('rejects unknown zone ids with 400', async () => {
        const { controller, widgetTypes, zones } = buildController();
        (widgetTypes.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (zones.has as ReturnType<typeof vi.fn>).mockReturnValue(false);

        const res = buildResponse();
        await controller.createPlacement(
            { body: { typeId: 't', zoneId: 'ghost-zone', routes: ['/'] } } as Request,
            res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('Unknown zone id')
        }));
    });

    it('rejects malformed route patterns', async () => {
        const { controller, widgetTypes, zones } = buildController();
        (widgetTypes.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (zones.has as ReturnType<typeof vi.fn>).mockReturnValue(true);

        const res = buildResponse();
        await controller.createPlacement(
            { body: { typeId: 't', zoneId: 'main-after', routes: ['no-slash'] } } as Request,
            res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('Invalid route pattern')
        }));
    });

    it('rejects orders outside the allowed range', async () => {
        const { controller, widgetTypes, zones } = buildController();
        (widgetTypes.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (zones.has as ReturnType<typeof vi.fn>).mockReturnValue(true);

        const res = buildResponse();
        await controller.createPlacement(
            { body: { typeId: 't', zoneId: 'main-after', routes: [], order: -1 } } as Request,
            res
        );

        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('creates an operator-source placement on valid input', async () => {
        const { controller, placements, widgetTypes, zones } = buildController();
        (widgetTypes.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (zones.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (placements.create as ReturnType<typeof vi.fn>).mockResolvedValue(buildPlacement({ id: 'new-id' }));

        const res = buildResponse();
        await controller.createPlacement(
            {
                body: {
                    typeId: 't',
                    zoneId: 'main-after',
                    routes: ['/'],
                    order: 10,
                    title: 'Hello',
                    enabled: true
                }
            } as Request,
            res
        );

        expect(placements.create).toHaveBeenCalledWith(
            expect.objectContaining({
                typeId: 't',
                zoneId: 'main-after',
                routes: ['/'],
                order: 10,
                title: 'Hello',
                enabled: true
            }),
            { source: 'operator' }
        );
        expect(res.status).toHaveBeenCalledWith(201);
    });
});

describe('PlacementsController.updatePlacement', () => {
    it('rejects unknown zone ids in the patch', async () => {
        const { controller, zones } = buildController();
        (zones.has as ReturnType<typeof vi.fn>).mockReturnValue(false);

        const res = buildResponse();
        await controller.updatePlacement(
            { params: { id: 'abc' }, body: { zoneId: 'phantom' } } as unknown as Request,
            res
        );

        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when the placement disappears', async () => {
        const { controller, placements } = buildController();
        (placements.update as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const res = buildResponse();
        await controller.updatePlacement(
            { params: { id: 'abc' }, body: { order: 5 } } as unknown as Request,
            res
        );

        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('passes the patch to the service on valid input', async () => {
        const { controller, placements } = buildController();
        (placements.update as ReturnType<typeof vi.fn>).mockResolvedValue(buildPlacement());

        await controller.updatePlacement(
            { params: { id: 'abc' }, body: { order: 5, enabled: false } } as unknown as Request,
            buildResponse()
        );

        expect(placements.update).toHaveBeenCalledWith('abc', { order: 5, enabled: false });
    });
});

describe('PlacementsController.deletePlacement', () => {
    it('refuses to delete plugin-source rows', async () => {
        const { controller, placements } = buildController();
        (placements.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildPlacement({ source: 'plugin', pluginId: 'p' }));

        const res = buildResponse();
        await controller.deletePlacement({ params: { id: 'abc' } } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(placements.delete).not.toHaveBeenCalled();
    });

    it('deletes operator-source rows', async () => {
        const { controller, placements } = buildController();
        (placements.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildPlacement({ source: 'operator' }));
        (placements.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

        const res = buildResponse();
        await controller.deletePlacement({ params: { id: 'abc' } } as unknown as Request, res);

        expect(placements.delete).toHaveBeenCalledWith('abc');
        expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns 404 when the placement is missing', async () => {
        const { controller, placements } = buildController();
        (placements.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const res = buildResponse();
        await controller.deletePlacement({ params: { id: 'abc' } } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('PlacementsController.restorePluginDefaults', () => {
    it('rejects operator-source rows', async () => {
        const { controller, placements } = buildController();
        (placements.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildPlacement({ source: 'operator' }));

        const res = buildResponse();
        await controller.restorePluginDefaults({ params: { id: 'abc' } } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 409 when defaults are not cached', async () => {
        const { controller, placements } = buildController({
            getPluginDefault: () => null
        });
        (placements.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildPlacement({
            source: 'plugin',
            pluginId: 'p',
            typeId: 't'
        }));

        const res = buildResponse();
        await controller.restorePluginDefaults({ params: { id: 'abc' } } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(409);
    });

    it('restores via the service when defaults exist', async () => {
        const { controller, placements } = buildController({
            getPluginDefault: () => ({
                pluginId: 'p',
                typeId: 't',
                zone: 'main-after',
                routes: ['/'],
                order: 25,
                title: 'Default'
            })
        });
        (placements.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildPlacement({
            id: 'abc',
            source: 'plugin',
            pluginId: 'p',
            typeId: 't'
        }));
        (placements.restoreToPluginDefaults as ReturnType<typeof vi.fn>).mockResolvedValue(buildPlacement({ id: 'abc' }));

        const res = buildResponse();
        await controller.restorePluginDefaults({ params: { id: 'abc' } } as unknown as Request, res);

        expect(placements.restoreToPluginDefaults).toHaveBeenCalledWith('abc', {
            zoneId: 'main-after',
            routes: ['/'],
            order: 25,
            title: 'Default'
        });
        expect(res.json).toHaveBeenCalledWith({ success: true, placement: expect.any(Object) });
    });
});
