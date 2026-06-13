/**
 * @file ai-tools-module.test.ts
 *
 * Covers the AI tools module's two-phase lifecycle and the governance
 * behaviors that make the module worth having: capability-driven default-deny,
 * the governor pipeline (unknown/disabled denial, successful execution), the
 * autonomous-path bar on external tools, human-approval holding, and hook veto.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookAbortError } from '@/types';
import type { IAiTool, IHookRegistry, IToolInvocationContext } from '@/types';
import { AiToolsModule } from '../index.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';

/** Minimal hook registry whose `invoke` is a no-op unless a test overrides it. */
function createMockHookRegistry(): IHookRegistry {
    return {
        register: vi.fn(() => () => undefined),
        disposeForPlugin: vi.fn(() => 0),
        snapshot: vi.fn(() => ({ tracks: [] })),
        invoke: vi.fn(async () => undefined)
    } as unknown as IHookRegistry;
}

/** A strictly read-only tool with a spy handler. */
function readTool(handler = vi.fn(async () => ({ ok: true }))): IAiTool {
    return {
        name: 'test-read',
        description: 'A read-only test tool.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        capability: { sideEffect: 'read', reversible: true, sensitivity: 'internal' },
        handler
    };
}

/** An external, irreversible tool (the dangerous class). */
function externalTool(handler = vi.fn(async () => ({ posted: true }))): IAiTool {
    return {
        name: 'test-external',
        description: 'An external, irreversible test tool.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        capability: { sideEffect: 'external', reversible: false, sensitivity: 'public' },
        handler
    };
}

const interactiveCtx: IToolInvocationContext = { actor: { kind: 'admin', id: 'admin-1' }, triggerPath: 'interactive', aiProviderId: 'test-provider' };
const scheduledCtx: IToolInvocationContext = { actor: { kind: 'system' }, triggerPath: 'scheduled', aiProviderId: 'test-provider' };

describe('AiToolsModule', () => {
    let module: AiToolsModule;
    let mockApp: { use: ReturnType<typeof vi.fn> };
    let mockRegistry: ReturnType<typeof createMockServiceRegistry>;
    let mockHooks: IHookRegistry;

    beforeEach(async () => {
        module = new AiToolsModule();
        mockApp = { use: vi.fn() };
        mockRegistry = createMockServiceRegistry();
        mockHooks = createMockHookRegistry();
        await module.init({
            database: createMockDatabaseService(),
            serviceRegistry: mockRegistry,
            hookRegistry: mockHooks,
            app: mockApp as never
        });
    });

    describe('metadata', () => {
        it('identifies as the ai-tools module', () => {
            expect(module.metadata.id).toBe('ai-tools');
            expect(module.metadata.name).toBe('AI Tools');
            expect(module.metadata.version).toBe('1.0.0');
        });
    });

    describe('lifecycle', () => {
        it('does not mount routes or register services during init()', () => {
            expect(mockApp.use).not.toHaveBeenCalled();
            expect(mockRegistry.get('ai-tools')).toBeUndefined();
            expect(mockRegistry.get('ai-tool-governor')).toBeUndefined();
        });

        it('mounts the admin router and registers services during run()', async () => {
            await module.run();
            expect(mockApp.use).toHaveBeenCalledWith('/api/admin/system/ai-tools', expect.any(Function));
            expect(mockRegistry.get('ai-tools')).toBeDefined();
            expect(mockRegistry.get('ai-tool-governor')).toBeDefined();
        });
    });

    describe('capability-driven default state', () => {
        it('enables a read tool by default and disables a dangerous one', () => {
            const registry = module.getRegistry();
            registry.registerTool(readTool(), 'test');
            registry.registerTool(externalTool(), 'test');

            const info = registry.listToolInfo();
            expect(info.find(t => t.name === 'test-read')?.enabled).toBe(true);
            expect(info.find(t => t.name === 'test-external')?.enabled).toBe(false);
        });
    });

    describe('governor', () => {
        it('denies an unknown tool', async () => {
            const result = await module.getGovernor().invoke('nope', {}, interactiveCtx);
            expect(result.status).toBe('denied');
        });

        it('runs an enabled read tool and returns its result', async () => {
            const handler = vi.fn(async () => ({ ok: true }));
            module.getRegistry().registerTool(readTool(handler), 'test');

            const result = await module.getGovernor().invoke('test-read', {}, interactiveCtx);

            expect(result.status).toBe('ok');
            expect(handler).toHaveBeenCalledOnce();
            expect(result.content).toEqual({ ok: true });
        });

        it('denies a disabled tool', async () => {
            const registry = module.getRegistry();
            registry.registerTool(readTool(), 'test');
            await registry.setEnabled('test-read', false);

            const result = await module.getGovernor().invoke('test-read', {}, interactiveCtx);
            expect(result.status).toBe('denied');
        });

        it('holds an interactive external/irreversible call for approval', async () => {
            const handler = vi.fn(async () => ({ posted: true }));
            const registry = module.getRegistry();
            registry.registerTool(externalTool(handler), 'test');
            await registry.setEnabled('test-external', true); // opt the dangerous tool in

            const result = await module.getGovernor().invoke('test-external', {}, interactiveCtx);

            expect(result.status).toBe('pending-approval');
            expect(handler).not.toHaveBeenCalled();
        });

        it('bars an external tool on an autonomous (scheduled) run', async () => {
            const registry = module.getRegistry();
            registry.registerTool(externalTool(), 'test');
            await registry.setEnabled('test-external', true);

            const result = await module.getGovernor().invoke('test-external', {}, scheduledCtx);
            expect(result.status).toBe('denied');
        });

        it('denies when a pre-invocation hook vetoes via HookAbortError', async () => {
            module.getRegistry().registerTool(readTool(), 'test');
            (mockHooks.invoke as ReturnType<typeof vi.fn>).mockImplementation(async (descriptor: { id: string }) => {
                if (descriptor.id === 'ai.toolInvoke') {
                    throw new HookAbortError('blocked by compliance');
                }
            });

            const result = await module.getGovernor().invoke('test-read', {}, interactiveCtx);
            expect(result.status).toBe('denied');
            expect(result.error).toContain('blocked by compliance');
        });

        it('rejects input that violates the tool schema', async () => {
            const tool: IAiTool = {
                name: 'needs-id',
                description: 'requires an id',
                inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
                capability: { sideEffect: 'read', reversible: true, sensitivity: 'internal' },
                handler: vi.fn(async () => ({}))
            };
            module.getRegistry().registerTool(tool, 'test');

            const result = await module.getGovernor().invoke('needs-id', {}, interactiveCtx);
            expect(result.status).toBe('denied');
            expect(result.error).toContain('id');
        });
    });
});
