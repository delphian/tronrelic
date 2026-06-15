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
import type { IAiTool, IAiToolCapability, IHookRegistry, IMenuService, ISchedulerService, ISystemLogService, IToolInvocationContext } from '@/types';
import { AiToolsModule, AUDIT_PRUNE_JOB, ToolApprovalQueue, detectTrifecta } from '../index.js';
import { ToolPolicyEngine } from '../services/tool-policy-engine.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';

/** Minimal menu service whose `create` records the admin nav registration. */
function createMockMenuService(): IMenuService {
    return { create: vi.fn(async () => ({ _id: 'menu-ai-tools' })) } as unknown as IMenuService;
}

/** Minimal logger that swallows every level and returns itself for `child()`. */
function createMockLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
        child: vi.fn(() => logger)
    };
    return logger as unknown as ISystemLogService;
}

/** Minimal scheduler whose `register` records the job name, schedule, and handler. */
function createMockScheduler(): ISchedulerService {
    return {
        register: vi.fn(),
        unregister: vi.fn(async () => undefined)
    } as unknown as ISchedulerService;
}

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

/**
 * A self-curated external/irreversible tool: it forces its own human curator
 * review, so the governor derives no approval gate (the curator is the approval)
 * and it is safe on autonomous paths (an unattended call can only draft into the
 * curator's queue).
 */
function curatedExternalTool(handler = vi.fn(async () => ({ sent: true }))): IAiTool {
    return {
        name: 'test-curated',
        description: 'An external, irreversible tool that forces its own curator review.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        capability: { sideEffect: 'external', reversible: false, sensitivity: 'public', forcesCuratorReview: true },
        handler
    };
}

/** A paid external tool (reversible, so interactive calls skip the approval gate). */
function paidTool(costPerCallUsd?: number): IAiTool {
    return {
        name: 'paid-gen',
        description: 'A paid external test tool.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        capability: { sideEffect: 'external', reversible: true, sensitivity: 'internal', spendsMoney: true, costPerCallUsd },
        handler: vi.fn(async () => ({}))
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
            menuService: createMockMenuService(),
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

        it('registers the audit retention job when a scheduler is injected', async () => {
            const scheduler = createMockScheduler();
            const scheduledModule = new AiToolsModule();
            await scheduledModule.init({
                database: createMockDatabaseService(),
                serviceRegistry: createMockServiceRegistry(),
                hookRegistry: createMockHookRegistry(),
                menuService: createMockMenuService(),
                app: { use: vi.fn() } as never,
                scheduler
            });
            await scheduledModule.run();

            const register = scheduler.register as ReturnType<typeof vi.fn>;
            expect(register).toHaveBeenCalledWith(AUDIT_PRUNE_JOB, expect.any(String), expect.any(Function));
            // The handler must run the retention sweep without throwing.
            const handler = register.mock.calls.find(c => c[0] === AUDIT_PRUNE_JOB)?.[2] as () => Promise<void>;
            await expect(handler()).resolves.toBeUndefined();
        });

        it('runs without a scheduler (no retention job registered)', async () => {
            // The beforeEach module omits the scheduler; run() must not throw.
            await module.run();
            expect(mockApp.use).toHaveBeenCalledWith('/api/admin/system/ai-tools', expect.any(Function));
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

        it('permits a self-curated external tool on an autonomous run', async () => {
            const handler = vi.fn(async () => ({ sent: true }));
            const registry = module.getRegistry();
            registry.registerTool(curatedExternalTool(handler), 'test');
            await registry.setEnabled('test-curated', true); // external ships disabled

            const result = await module.getGovernor().invoke('test-curated', {}, scheduledCtx);
            expect(result.status).toBe('ok');
            expect(handler).toHaveBeenCalledOnce();
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

    describe('broadcast signals', () => {
        it('emits an activity refetch signal on every invocation', async () => {
            const events: string[] = [];
            module.getGovernor().setBroadcast((event) => events.push(event));
            module.getRegistry().registerTool(readTool(), 'test');

            await module.getGovernor().invoke('test-read', {}, interactiveCtx);

            expect(events).toContain('ai-tools:activity');
        });

        it('emits an approvals-changed signal when an interactive external call is held', async () => {
            const events: string[] = [];
            const governor = module.getGovernor();
            governor.setBroadcast((event) => events.push(event));
            const registry = module.getRegistry();
            registry.registerTool(externalTool(), 'test');
            await registry.setEnabled('test-external', true);

            const result = await governor.invoke('test-external', {}, interactiveCtx);

            expect(result.status).toBe('pending-approval');
            expect(events).toContain('ai-tools:approvals-changed');
        });
    });

    describe('trifecta detection', () => {
        /** Register an enabled-by-default tool carrying the given capability. */
        function register(name: string, capability: IAiToolCapability): void {
            module.getRegistry().registerTool({
                name,
                description: name,
                inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
                capability,
                handler: vi.fn(async () => ({}))
            }, 'test');
        }

        it('flags the trifecta when an enabled secret reader, untrusted source, and external sink co-exist', async () => {
            register('secret-reader', { sideEffect: 'read', reversible: true, sensitivity: 'secret' });
            register('memo-reader', { sideEffect: 'read', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true });
            register('poster', { sideEffect: 'external', reversible: false, sensitivity: 'public' });
            await module.getRegistry().setEnabled('poster', true); // external ships disabled

            const status = detectTrifecta(module.getRegistry().listToolInfo());
            expect(status.present).toBe(true);
            expect(status.privateData).toContain('secret-reader');
            expect(status.untrustedContent).toContain('memo-reader');
            expect(status.exfiltration).toContain('poster');
        });

        it('does not flag when the exfiltration leg is disabled', () => {
            register('secret-reader', { sideEffect: 'read', reversible: true, sensitivity: 'secret' });
            register('memo-reader', { sideEffect: 'read', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true });
            register('poster', { sideEffect: 'external', reversible: false, sensitivity: 'public' }); // stays disabled by default

            const status = detectTrifecta(module.getRegistry().listToolInfo());
            expect(status.present).toBe(false);
            expect(status.exfiltration).toHaveLength(0);
        });
    });
});

describe('ToolPolicyEngine cost ceiling', () => {
    /** Build an engine over fresh mock dependencies. */
    function makeEngine(): ToolPolicyEngine {
        return new ToolPolicyEngine(createMockLogger(), createMockDatabaseService());
    }

    it('charges the declared per-call cost and denies once the ceiling would be exceeded', async () => {
        const engine = makeEngine();
        await engine.setOverride('paid-gen', { costCeilingUsd: 0.10 });
        const tool = paidTool(0.04);

        const verdicts = [
            engine.check(tool, interactiveCtx).verdict, // spend → 0.04
            engine.check(tool, interactiveCtx).verdict, // spend → 0.08
            engine.check(tool, interactiveCtx).verdict  // 0.12 would exceed 0.10
        ];

        expect(verdicts).toEqual(['allow', 'allow', 'deny']);
    });

    it('cannot cap a tool that declares no per-call cost', async () => {
        const engine = makeEngine();
        await engine.setOverride('paid-gen', { costCeilingUsd: 0.01 });
        const tool = paidTool(undefined); // spendsMoney but nothing to charge

        const verdicts = [0, 1, 2].map(() => engine.check(tool, interactiveCtx).verdict);
        expect(verdicts).toEqual(['allow', 'allow', 'allow']);
    });

    it('leaves a paid tool uncapped when no ceiling override is set', () => {
        const engine = makeEngine();
        const tool = paidTool(5); // expensive per call, but no ceiling

        expect(engine.check(tool, interactiveCtx).verdict).toBe('allow');
        expect(engine.check(tool, interactiveCtx).verdict).toBe('allow');
    });

    it('gates and charges the approved-execution path (tryChargeCost) at the ceiling', async () => {
        // The governor calls this for an approved hold, which bypasses check();
        // it must charge and deny the same way so approval-required paid tools
        // are governed too.
        const engine = makeEngine();
        await engine.setOverride('paid-gen', { costCeilingUsd: 0.10 });
        const tool = paidTool(0.04);

        const admits = [engine.tryChargeCost(tool), engine.tryChargeCost(tool), engine.tryChargeCost(tool)];

        expect(admits).toEqual([true, true, false]);
    });

    it('admits a call that exactly meets the ceiling despite float accumulation', async () => {
        const engine = makeEngine();
        await engine.setOverride('paid-gen', { costCeilingUsd: 0.30 });
        const tool = paidTool(0.10); // 0.1 + 0.1 + 0.1 === 0.30000000000000004 in IEEE 754

        const admits = [
            engine.tryChargeCost(tool),
            engine.tryChargeCost(tool),
            engine.tryChargeCost(tool), // exactly meets 0.30 — the epsilon must admit, not float-deny
            engine.tryChargeCost(tool)  // genuinely exceeds
        ];

        expect(admits).toEqual([true, true, true, false]);
    });
});

describe('ToolApprovalQueue', () => {
    /** Build a queue over a fresh mock database. */
    function makeQueue(): ToolApprovalQueue {
        return new ToolApprovalQueue(createMockLogger(), createMockDatabaseService());
    }

    it('resolves a pending request only once under concurrent approvals', async () => {
        const queue = makeQueue();
        await queue.enqueue({
            id: 'req-1',
            toolName: 'test-external',
            providerId: 'test',
            input: {},
            context: interactiveCtx
        });

        // Two simultaneous approvals race to resolve the same request. The
        // conditional update must let exactly one win so the governor runs the
        // handler once, not twice.
        const [a, b] = await Promise.all([
            queue.resolve('req-1', 'approved', 'admin-1'),
            queue.resolve('req-1', 'approved', 'admin-2')
        ]);

        expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it('returns null when resolving an already-resolved request', async () => {
        const queue = makeQueue();
        await queue.enqueue({ id: 'req-2', toolName: 't', providerId: 'test', input: {}, context: interactiveCtx });

        expect(await queue.resolve('req-2', 'approved', 'admin-1')).not.toBeNull();
        expect(await queue.resolve('req-2', 'rejected', 'admin-2')).toBeNull();
    });
});
