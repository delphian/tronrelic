/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the placement admin controller's
 * instanceConfig schema validation path.
 *
 * Phase 2 of the per-placement instanceConfig work introduced AJV
 * validation against the widget type's declared `configSchema`. These
 * tests cover the structured 400 path on schema failure, the
 * pass-through when no schema is declared, and the patch-side lookup
 * via the existing placement's typeId.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { JSONSchema7 } from 'json-schema';
import type { ISystemLogService, IWidgetsService, IWidgetPlacement } from '@/types';
import { PlacementsController } from '../api/placements.controller.js';

/**
 * Build a minimal `IWidgetsService` stub. Each test overrides the
 * methods it actually exercises so failures from unrelated calls are
 * easy to spot (the default `vi.fn()` returns undefined / throws on
 * await).
 */
function buildWidgetsServiceStub(overrides: Partial<IWidgetsService> = {}): IWidgetsService {
    const stub: Partial<IWidgetsService> = {
        listZones: vi.fn(() => ({ tracks: [] })),
        listTypes: vi.fn(() => ({ groups: [] })),
        hasZone: vi.fn(() => true),
        hasType: vi.fn(() => true),
        getTypeConfigSchema: vi.fn(() => undefined),
        fetchWidgetsForRoute: vi.fn(async () => []),
        registerType: vi.fn(),
        registerZone: vi.fn(),
        registerWidget: vi.fn(),
        unregisterAllForOwner: vi.fn(),
        listPlacements: vi.fn(async () => []),
        findPlacementById: vi.fn(async () => null),
        createPlacement: vi.fn(),
        updatePlacement: vi.fn(),
        deletePlacement: vi.fn(),
        restorePluginDefaults: vi.fn(),
        ...overrides
    };
    return stub as IWidgetsService;
}

/**
 * Build a minimal `ISystemLogService` stub — only `error` / `warn`
 * are exercised by the controller paths these tests touch.
 */
function buildLoggerStub(): ISystemLogService {
    return {
        level: 'info',
        fatal: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(function (this: ISystemLogService) { return this; }),
        initialize: vi.fn(async () => {}),
        saveLog: vi.fn(async () => {}),
        getLogs: vi.fn(async () => ({
            logs: [], total: 0, page: 1, limit: 50, totalPages: 0,
            hasNextPage: false, hasPrevPage: false
        })),
        markAsResolved: vi.fn(async () => {}),
        cleanup: vi.fn(async () => 0),
        getStatistics: vi.fn(async () => ({
            total: 0, byLevel: {} as any, byService: {}, unresolved: 0
        })),
        getLogById: vi.fn(async () => null),
        markAsUnresolved: vi.fn(async () => null),
        deleteAllLogs: vi.fn(async () => 0),
        getStats: vi.fn(async () => ({ total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 })),
        waitUntilInitialized: vi.fn(async () => {})
    } as unknown as ISystemLogService;
}

/**
 * Construct a minimal Express response stub recording `status()` and
 * `json()` calls so assertions can inspect the wire shape.
 */
function buildResponseStub() {
    const json = vi.fn();
    const end = vi.fn();
    const res = {
        status: vi.fn().mockReturnThis(),
        json,
        end
    };
    return res as unknown as Response & {
        status: ReturnType<typeof vi.fn>;
        json: typeof json;
        end: typeof end;
    };
}

const validCreateBody = {
    typeId: 'plugin:type',
    zoneId: 'main-after',
    routes: [],
    enabled: true
};

describe('PlacementsController instanceConfig schema validation', () => {
    let widgets: IWidgetsService;
    let logger: ISystemLogService;
    let controller: PlacementsController;
    let res: ReturnType<typeof buildResponseStub>;

    beforeEach(() => {
        logger = buildLoggerStub();
        res = buildResponseStub();
    });

    describe('createPlacement', () => {
        it('rejects schema-invalid instanceConfig with 400 and per-field errors', async () => {
            const schema: JSONSchema7 = {
                type: 'object',
                properties: {
                    maxPosts: { type: 'integer', minimum: 1, maximum: 20 }
                },
                required: ['maxPosts'],
                additionalProperties: false
            };
            widgets = buildWidgetsServiceStub({
                getTypeConfigSchema: vi.fn(() => schema),
                createPlacement: vi.fn(async () => { throw new Error('should not reach service'); })
            });
            controller = new PlacementsController(widgets, logger);

            const req = {
                body: {
                    ...validCreateBody,
                    instanceConfig: { maxPosts: 99 } // exceeds maximum
                }
            } as Request;

            await controller.createPlacement(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            const payload = res.json.mock.calls[0][0];
            expect(payload.success).toBe(false);
            expect(payload.error).toMatch(/instanceConfig/);
            expect(Array.isArray(payload.errors)).toBe(true);
            expect(payload.errors.length).toBeGreaterThan(0);
            expect(payload.errors[0]).toEqual(
                expect.objectContaining({
                    path: expect.stringContaining('maxPosts'),
                    message: expect.any(String)
                })
            );
            expect(widgets.createPlacement).not.toHaveBeenCalled();
        });

        it('accepts instanceConfig when no schema is declared and proceeds to the service', async () => {
            widgets = buildWidgetsServiceStub({
                getTypeConfigSchema: vi.fn(() => undefined),
                createPlacement: vi.fn(async () => ({ id: 'new-id' } as IWidgetPlacement))
            });
            controller = new PlacementsController(widgets, logger);

            const req = {
                body: {
                    ...validCreateBody,
                    instanceConfig: { anything: 'goes', count: 7 }
                }
            } as Request;

            await controller.createPlacement(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(widgets.createPlacement).toHaveBeenCalledTimes(1);
            expect(widgets.createPlacement).toHaveBeenCalledWith(
                expect.objectContaining({
                    instanceConfig: { anything: 'goes', count: 7 }
                })
            );
        });

        it('accepts schema-valid instanceConfig and forwards to the service', async () => {
            const schema: JSONSchema7 = {
                type: 'object',
                properties: {
                    maxPosts: { type: 'integer', minimum: 1, maximum: 20 }
                },
                additionalProperties: false
            };
            widgets = buildWidgetsServiceStub({
                getTypeConfigSchema: vi.fn(() => schema),
                createPlacement: vi.fn(async () => ({ id: 'new-id' } as IWidgetPlacement))
            });
            controller = new PlacementsController(widgets, logger);

            const req = {
                body: {
                    ...validCreateBody,
                    instanceConfig: { maxPosts: 5 }
                }
            } as Request;

            await controller.createPlacement(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(widgets.createPlacement).toHaveBeenCalledTimes(1);
        });
    });

    describe('updatePlacement', () => {
        it('rejects schema-invalid instanceConfig on patch with 400 and per-field errors', async () => {
            const schema: JSONSchema7 = {
                type: 'object',
                properties: { theme: { enum: ['light', 'dark'] } },
                additionalProperties: false
            };
            const existing = {
                id: 'p-1',
                typeId: 'plugin:type',
                zoneId: 'main-after',
                routes: [],
                order: 100,
                enabled: true,
                source: 'operator',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            } as IWidgetPlacement;

            widgets = buildWidgetsServiceStub({
                getTypeConfigSchema: vi.fn(() => schema),
                findPlacementById: vi.fn(async () => existing),
                updatePlacement: vi.fn(async () => { throw new Error('should not reach service'); })
            });
            controller = new PlacementsController(widgets, logger);

            const req = {
                params: { id: 'p-1' },
                body: { instanceConfig: { theme: 'neon' } } // not in enum
            } as unknown as Request;

            await controller.updatePlacement(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            const payload = res.json.mock.calls[0][0];
            expect(payload.success).toBe(false);
            expect(Array.isArray(payload.errors)).toBe(true);
            expect(payload.errors[0]).toEqual(
                expect.objectContaining({ path: expect.stringContaining('theme') })
            );
            expect(widgets.updatePlacement).not.toHaveBeenCalled();
        });

        it('returns 404 when the patch targets a placement that no longer exists', async () => {
            widgets = buildWidgetsServiceStub({
                getTypeConfigSchema: vi.fn(() => ({ type: 'object' } as JSONSchema7)),
                findPlacementById: vi.fn(async () => null),
                updatePlacement: vi.fn()
            });
            controller = new PlacementsController(widgets, logger);

            const req = {
                params: { id: 'p-missing' },
                body: { instanceConfig: { foo: 1 } }
            } as unknown as Request;

            await controller.updatePlacement(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(widgets.updatePlacement).not.toHaveBeenCalled();
        });
    });
});

describe('PlacementsController titleUrl validation', () => {
    let widgets: IWidgetsService;
    let logger: ISystemLogService;
    let controller: PlacementsController;
    let res: ReturnType<typeof buildResponseStub>;

    beforeEach(() => {
        logger = buildLoggerStub();
        res = buildResponseStub();
    });

    it('rejects an off-site titleUrl with 400 and never reaches the service', async () => {
        widgets = buildWidgetsServiceStub({
            createPlacement: vi.fn(async () => { throw new Error('should not reach service'); })
        });
        controller = new PlacementsController(widgets, logger);

        const req = {
            body: { ...validCreateBody, titleUrl: 'https://evil.example.com' }
        } as Request;

        await controller.createPlacement(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0].error).toMatch(/titleUrl/);
        expect(widgets.createPlacement).not.toHaveBeenCalled();
    });

    it('rejects a protocol-relative titleUrl', async () => {
        widgets = buildWidgetsServiceStub();
        controller = new PlacementsController(widgets, logger);

        const req = {
            body: { ...validCreateBody, titleUrl: '//evil.example.com' }
        } as Request;

        await controller.createPlacement(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(widgets.createPlacement).not.toHaveBeenCalled();
    });

    it.each([
        '/..//evil.example.com',
        '/abc/..//evil.example.com',
        '/markets//holdings'
    ])('rejects a titleUrl with a traversal or double-slash bypass: %s', async (titleUrl) => {
        widgets = buildWidgetsServiceStub({
            createPlacement: vi.fn(async () => { throw new Error('should not reach service'); })
        });
        controller = new PlacementsController(widgets, logger);

        const req = {
            body: { ...validCreateBody, titleUrl }
        } as Request;

        await controller.createPlacement(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(widgets.createPlacement).not.toHaveBeenCalled();
    });

    it('accepts an internal root-relative titleUrl and forwards it to the service', async () => {
        widgets = buildWidgetsServiceStub({
            createPlacement: vi.fn(async () => ({ id: 'new-id' } as IWidgetPlacement))
        });
        controller = new PlacementsController(widgets, logger);

        const req = {
            body: { ...validCreateBody, titleUrl: '/markets?tab=energy' }
        } as Request;

        await controller.createPlacement(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(widgets.createPlacement).toHaveBeenCalledWith(
            expect.objectContaining({ titleUrl: '/markets?tab=energy' })
        );
    });

    it('forwards titleUrl: null on patch as an explicit clear signal', async () => {
        widgets = buildWidgetsServiceStub({
            updatePlacement: vi.fn(async () => ({ id: 'p1' } as IWidgetPlacement))
        });
        controller = new PlacementsController(widgets, logger);

        const req = {
            params: { id: 'p1' },
            body: { titleUrl: null }
        } as unknown as Request;

        await controller.updatePlacement(req, res);

        expect(widgets.updatePlacement).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ titleUrl: null })
        );
    });
});

describe('PlacementsController titleSize validation', () => {
    let widgets: IWidgetsService;
    let controller: PlacementsController;
    let logger: ISystemLogService;
    let res: ReturnType<typeof buildResponseStub>;

    beforeEach(() => {
        logger = buildLoggerStub();
        res = buildResponseStub();
    });

    it('rejects an unknown titleSize with 400 and never reaches the service', async () => {
        widgets = buildWidgetsServiceStub({ createPlacement: vi.fn() });
        controller = new PlacementsController(widgets, logger);

        const req = { body: { ...validCreateBody, titleSize: 'heading-huge' } } as Request;
        await controller.createPlacement(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0].error).toMatch(/titleSize/);
        expect(widgets.createPlacement).not.toHaveBeenCalled();
    });

    it('accepts a valid titleSize and forwards it to the service', async () => {
        widgets = buildWidgetsServiceStub({
            createPlacement: vi.fn(async () => ({ id: 'new-id' } as IWidgetPlacement))
        });
        controller = new PlacementsController(widgets, logger);

        const req = { body: { ...validCreateBody, titleSize: 'heading-lg' } } as Request;
        await controller.createPlacement(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(widgets.createPlacement).toHaveBeenCalledWith(
            expect.objectContaining({ titleSize: 'heading-lg' })
        );
    });

    it('forwards titleSize: null on patch as an explicit revert-to-default signal', async () => {
        widgets = buildWidgetsServiceStub({
            updatePlacement: vi.fn(async () => ({ id: 'p1' } as IWidgetPlacement))
        });
        controller = new PlacementsController(widgets, logger);

        const req = {
            params: { id: 'p1' },
            body: { titleSize: null }
        } as unknown as Request;

        await controller.updatePlacement(req, res);

        expect(widgets.updatePlacement).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ titleSize: null })
        );
    });
});

describe('PlacementsController layoutWeight validation', () => {
    let widgets: IWidgetsService;
    let logger: ISystemLogService;
    let controller: PlacementsController;
    let res: ReturnType<typeof buildResponseStub>;

    beforeEach(() => {
        logger = buildLoggerStub();
        res = buildResponseStub();
    });

    it.each([0, 13, 2.5, -1])('rejects an out-of-range or fractional layoutWeight: %s', async (layoutWeight) => {
        widgets = buildWidgetsServiceStub({
            createPlacement: vi.fn(async () => { throw new Error('should not reach service'); })
        });
        controller = new PlacementsController(widgets, logger);

        const req = { body: { ...validCreateBody, layoutWeight } } as Request;

        await controller.createPlacement(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0].error).toMatch(/layoutWeight/);
        expect(widgets.createPlacement).not.toHaveBeenCalled();
    });

    it('accepts an in-range layoutWeight and forwards it to the service', async () => {
        widgets = buildWidgetsServiceStub({
            createPlacement: vi.fn(async () => ({ id: 'new-id' } as IWidgetPlacement))
        });
        controller = new PlacementsController(widgets, logger);

        const req = { body: { ...validCreateBody, layoutWeight: 2 } } as Request;

        await controller.createPlacement(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(widgets.createPlacement).toHaveBeenCalledWith(
            expect.objectContaining({ layoutWeight: 2 })
        );
    });

    it('forwards layoutWeight: null on patch as an explicit clear signal', async () => {
        widgets = buildWidgetsServiceStub({
            updatePlacement: vi.fn(async () => ({ id: 'p1' } as IWidgetPlacement))
        });
        controller = new PlacementsController(widgets, logger);

        const req = {
            params: { id: 'p1' },
            body: { layoutWeight: null }
        } as unknown as Request;

        await controller.updatePlacement(req, res);

        expect(widgets.updatePlacement).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ layoutWeight: null })
        );
    });
});
