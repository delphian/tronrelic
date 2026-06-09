/// <reference types="vitest" />

/**
 * @file ai-tools.test.ts
 *
 * Tests for the logs module's AI tool registrations: parameter
 * validation, default/capped pagination, list-view context truncation,
 * and the omission of the deprecated `resolved` fields from every tool
 * surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerLogAiTools, AI_TOOL_NAMES } from '../ai-tools.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import type { IAiTool } from '@/types';

/**
 * Minimal logger stub satisfying the registration telemetry calls.
 */
function createMockLogger(): any {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn()
    };
}

/**
 * Fake SystemLogService exposing only the read methods the tools use.
 */
function createMockLogService() {
    return {
        getLogs: vi.fn().mockResolvedValue({
            logs: [],
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false
        }),
        getLogById: vi.fn().mockResolvedValue(null),
        getStatistics: vi.fn().mockResolvedValue({
            total: 12,
            byLevel: { trace: 0, debug: 0, info: 5, warn: 4, error: 3, fatal: 0 },
            byService: { blockchain: 7, 'plugin:whale-alerts': 5 },
            unresolved: 3
        })
    };
}

/**
 * Register the tools against a mock registry and return them by name.
 */
function registerAndCapture(logService: any): Record<string, IAiTool> {
    const registry = createMockServiceRegistry();
    const captured: Record<string, IAiTool> = {};
    const ai = {
        registerTool: vi.fn((tool: IAiTool) => {
            captured[tool.name] = tool;
        }),
        unregisterTool: vi.fn().mockReturnValue(false)
    };
    registerLogAiTools(registry, logService, createMockLogger());
    registry.register('ai-assistant', ai);
    return captured;
}

describe('logs AI tools', () => {
    let logService: ReturnType<typeof createMockLogService>;
    let tools: Record<string, IAiTool>;

    beforeEach(() => {
        logService = createMockLogService();
        tools = registerAndCapture(logService);
    });

    describe(AI_TOOL_NAMES.queryLogs, () => {
        it('should default to error and warn levels with default pagination', async () => {
            await tools[AI_TOOL_NAMES.queryLogs].handler({});

            expect(logService.getLogs).toHaveBeenCalledWith(
                expect.objectContaining({
                    levels: ['error', 'warn'],
                    page: 1,
                    limit: 20
                })
            );
            // The deprecated resolved filter must never be sent
            expect(logService.getLogs.mock.calls[0][0]).not.toHaveProperty('resolved');
        });

        it('should cap limit at the maximum', async () => {
            await tools[AI_TOOL_NAMES.queryLogs].handler({ limit: 500 });

            expect(logService.getLogs).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 50 })
            );
        });

        it('should reject invalid levels', async () => {
            await expect(
                tools[AI_TOOL_NAMES.queryLogs].handler({ levels: ['error', 'bogus'] })
            ).rejects.toThrow('Invalid levels: bogus');
        });

        it('should reject malformed date strings', async () => {
            await expect(
                tools[AI_TOOL_NAMES.queryLogs].handler({ startTime: 'not-a-date' })
            ).rejects.toThrow('startTime');
        });

        it('should pass parsed date bounds to the service', async () => {
            await tools[AI_TOOL_NAMES.queryLogs].handler({
                startTime: '2026-06-09T00:00:00Z',
                endTime: '2026-06-09T12:00:00Z'
            });

            const query = logService.getLogs.mock.calls[0][0];
            expect(query.startDate).toEqual(new Date('2026-06-09T00:00:00Z'));
            expect(query.endDate).toEqual(new Date('2026-06-09T12:00:00Z'));
        });

        it('should omit resolved fields and truncate long context in list view', async () => {
            logService.getLogs.mockResolvedValue({
                logs: [{
                    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
                    timestamp: new Date('2026-06-09T01:00:00Z'),
                    level: 'error',
                    message: 'boom',
                    service: 'blockchain',
                    context: { stack: 'x'.repeat(2000) },
                    resolved: false,
                    resolvedBy: null
                }],
                total: 1, page: 1, limit: 20, totalPages: 1,
                hasNextPage: false, hasPrevPage: false
            });

            const result: any = await tools[AI_TOOL_NAMES.queryLogs].handler({});
            const entry = result.logs[0];

            expect(entry).not.toHaveProperty('resolved');
            expect(entry).not.toHaveProperty('resolvedBy');
            expect(typeof entry.context).toBe('string');
            expect(entry.context).toContain('[truncated');
            expect(result).not.toHaveProperty('hasPrevPage');
        });
    });

    describe(AI_TOOL_NAMES.getLog, () => {
        it('should reject ids that are not 24-char hex', async () => {
            await expect(
                tools[AI_TOOL_NAMES.getLog].handler({ id: 'nope' })
            ).rejects.toThrow('24-character hex');
        });

        it('should return the full entry without resolved fields', async () => {
            logService.getLogById.mockResolvedValue({
                _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
                timestamp: new Date(),
                level: 'warn',
                message: 'slow query',
                service: 'plugin:whale-alerts',
                context: { detail: 'y'.repeat(2000) },
                resolved: true,
                resolvedAt: new Date(),
                resolvedBy: 'admin'
            });

            const entry: any = await tools[AI_TOOL_NAMES.getLog].handler({
                id: 'bbbbbbbbbbbbbbbbbbbbbbbb'
            });

            expect(entry.id).toBe('bbbbbbbbbbbbbbbbbbbbbbbb');
            // Full context, no truncation in detail view
            expect(entry.context.detail).toHaveLength(2000);
            expect(entry).not.toHaveProperty('resolved');
            expect(entry).not.toHaveProperty('resolvedAt');
            expect(entry).not.toHaveProperty('resolvedBy');
        });

        it('should return null for a missing entry', async () => {
            const entry = await tools[AI_TOOL_NAMES.getLog].handler({
                id: 'cccccccccccccccccccccccc'
            });
            expect(entry).toBeNull();
        });
    });

    describe(AI_TOOL_NAMES.getStatistics, () => {
        it('should return counts without the unresolved field', async () => {
            const stats: any = await tools[AI_TOOL_NAMES.getStatistics].handler({});

            expect(stats.total).toBe(12);
            expect(stats.byLevel.error).toBe(3);
            expect(stats.byService.blockchain).toBe(7);
            expect(stats).not.toHaveProperty('unresolved');
        });
    });

    describe('registration lifecycle', () => {
        it('should unregister each tool name before registering', () => {
            const registry = createMockServiceRegistry();
            const ai = {
                registerTool: vi.fn(),
                unregisterTool: vi.fn().mockReturnValue(true)
            };
            registerLogAiTools(registry, logService as any, createMockLogger());
            registry.register('ai-assistant', ai);

            expect(ai.unregisterTool.mock.calls.map(call => call[0])).toEqual(
                Object.values(AI_TOOL_NAMES)
            );
        });
    });
});
