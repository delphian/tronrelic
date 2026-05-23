/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the widget-types introspection
 * controller.
 *
 * The controller is read-only — its only job is to forward the
 * registry snapshot to the client. The tests verify the snapshot is
 * passed through untouched, and that errors thrown by the registry
 * surface as a 500 instead of leaking.
 *
 * @module backend/modules/widgets/__tests__/widget-types.controller
 */

import { describe, it, expect, vi } from 'vitest';
import type {
    ISystemLogService,
    IWidgetTypeRegistry,
    IWidgetTypeSnapshot
} from '@/types';
import type { Request, Response } from 'express';
import { WidgetTypesController } from '../api/widget-types.controller.js';

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

function buildResponse(): Response {
    const res: Partial<Response> = {};
    res.status = vi.fn(() => res as Response) as any;
    res.json = vi.fn(() => res as Response) as any;
    return res as Response;
}

describe('WidgetTypesController.getSnapshot', () => {
    it('forwards the registry snapshot verbatim', () => {
        const snapshot: IWidgetTypeSnapshot = {
            groups: [
                {
                    pluginId: 'whale-alerts',
                    types: [
                        {
                            id: 'whale:recent',
                            label: 'Recent Whales',
                            description: 'Recent whale transactions',
                            category: null,
                            pluginId: 'whale-alerts',
                            registeredAt: '2026-01-01T00:00:00.000Z',
                            source: null
                        }
                    ]
                }
            ]
        };

        const registry = {
            snapshot: vi.fn(() => snapshot),
            register: vi.fn(),
            disposeForPlugin: vi.fn(),
            has: vi.fn(),
            get: vi.fn(),
            getOwnerPluginId: vi.fn()
        } as unknown as IWidgetTypeRegistry;

        const controller = new WidgetTypesController(registry, new MockLogger());
        const res = buildResponse();
        controller.getSnapshot({} as Request, res);

        expect(registry.snapshot).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(snapshot);
    });

    it('responds with 500 when the registry throws', () => {
        const registry = {
            snapshot: vi.fn(() => { throw new Error('boom'); }),
            register: vi.fn(),
            disposeForPlugin: vi.fn(),
            has: vi.fn(),
            get: vi.fn(),
            getOwnerPluginId: vi.fn()
        } as unknown as IWidgetTypeRegistry;

        const logger = new MockLogger();
        const controller = new WidgetTypesController(registry, logger);
        const res = buildResponse();
        controller.getSnapshot({} as Request, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(logger.error).toHaveBeenCalled();
    });
});
