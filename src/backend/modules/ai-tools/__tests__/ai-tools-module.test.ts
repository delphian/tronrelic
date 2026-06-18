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
import type { IAiTool, IAiToolCapability, IAiToolInfo, ICurationType, IHookRegistry, IMenuService, ISchedulerService, ISystemLogService, IToolInvocationContext } from '@/types';
import { AiToolsModule, AUDIT_PRUNE_JOB, CurationQueue, CurationService, ToolApprovalQueue, detectTrifecta } from '../index.js';
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

/**
 * A self-curated external tool bound to a core curation type. The binding turns
 * `forcesCuratorReview` from a claim into something the governor verifies: the
 * relaxation applies only while the bound type is registered.
 */
function boundCuratedTool(curationTypeId: string, handler = vi.fn(async () => ({ sent: true }))): IAiTool {
    return {
        name: 'test-bound',
        description: 'An external tool that routes every effect into a core curation type.',
        inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        capability: { sideEffect: 'external', reversible: false, sensitivity: 'public', forcesCuratorReview: true, curationTypeId },
        handler
    };
}

/** Build a curation type whose callbacks are spies, overridable per test. */
function spyCurationType(over: Partial<ICurationType> = {}): ICurationType {
    return {
        typeId: 'x-poster:tweet',
        label: 'Tweet',
        describe: vi.fn(async (ref: Record<string, unknown>) => ({ body: `draft ${String(ref.postId ?? '')}` })),
        onApprove: vi.fn(async () => undefined),
        onReject: vi.fn(async () => undefined),
        ...over
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

    describe('server-tool audit', () => {
        it('records a provider-hosted tool call: audited and observer-notified, owned by the AI provider', async () => {
            const events: string[] = [];
            const governor = module.getGovernor();
            governor.setBroadcast((event) => events.push(event));

            await governor.recordServerToolInvocation({
                toolName: 'web_fetch',
                capability: { sideEffect: 'external', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true },
                input: { url: 'https://example.com/a' },
                status: 'ok',
                context: interactiveCtx,
                resultDigest: '1 result(s)'
            });

            // The post-invocation observer seam fired with the built record — the
            // same path a governed call takes, so the lethal-trifecta watch sees it.
            const invoked = (mockHooks.invoke as ReturnType<typeof vi.fn>).mock.calls
                .find(call => (call[0] as { id?: string })?.id === 'ai.toolInvoked');
            expect(invoked).toBeDefined();
            const record = invoked?.[1] as { toolName: string; providerId: string; aiProviderId: string; status: string };
            expect(record.toolName).toBe('web_fetch');
            expect(record.status).toBe('ok');
            // A server tool has no registry owner — it is attributed to the AI
            // provider plugin that drove the call.
            expect(record.providerId).toBe('test-provider');
            expect(record.aiProviderId).toBe('test-provider');
            // And the activity feed got its refetch signal.
            expect(events).toContain('ai-tools:activity');
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

        /** The egress-gating predicate the detector consumes, from the real policy engine. */
        const egressGated = (name: string, cap: IAiToolCapability | undefined): boolean => module.getPolicy().isEgressGated(name, cap);

        it('flags the trifecta as lethal when an enabled secret reader, untrusted source, and OPEN external sink co-exist', async () => {
            register('secret-reader', { sideEffect: 'read', reversible: true, sensitivity: 'secret' });
            register('memo-reader', { sideEffect: 'read', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true });
            register('poster', { sideEffect: 'external', reversible: false, sensitivity: 'public' }); // no curator review → open egress
            await module.getRegistry().setEnabled('poster', true); // external ships disabled

            const status = detectTrifecta(module.getRegistry().listToolInfo(), egressGated);
            expect(status.severity).toBe('lethal');
            expect(status.present).toBe(true);
            expect(status.privateData).toContain('secret-reader');
            expect(status.untrustedContent).toContain('memo-reader');
            expect(status.exfiltration).toContain('poster');
            expect(status.exfiltrationOpen).toContain('poster');
            expect(status.exfiltrationGated).toHaveLength(0);
        });

        it('downgrades to supervised when every external sink forces honoured curator review', async () => {
            register('secret-reader', { sideEffect: 'read', reversible: true, sensitivity: 'secret' });
            register('memo-reader', { sideEffect: 'read', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true });
            // forcesCuratorReview with no curationTypeId → honoured (legacy self-hosted queue) → gated egress.
            register('curated-poster', { sideEffect: 'external', reversible: false, sensitivity: 'public', forcesCuratorReview: true });
            await module.getRegistry().setEnabled('curated-poster', true);

            const status = detectTrifecta(module.getRegistry().listToolInfo(), egressGated);
            expect(status.severity).toBe('supervised');
            expect(status.present).toBe(false); // not lethal: no autonomously closable egress
            expect(status.exfiltration).toContain('curated-poster'); // leg still present
            expect(status.exfiltrationGated).toContain('curated-poster');
            expect(status.exfiltrationOpen).toHaveLength(0);
        });

        it('flags lethal when a provider-reported server tool supplies the untrusted + open-egress legs (the F1 blind spot, now closed)', () => {
            // Only an enabled secret reader lives in the registry. The remaining
            // two legs arrive via the provider-reporting path: a web_fetch entry
            // (external open egress + surfacesUntrustedContent) the controller
            // concatenates onto listToolInfo() before calling the detector.
            register('secret-reader', { sideEffect: 'read', reversible: true, sensitivity: 'secret' });
            const serverTool: IAiToolInfo = {
                name: 'web_fetch',
                description: 'Anthropic web fetch — runs outside the governor.',
                inputSchema: { type: 'object', properties: {}, additionalProperties: true },
                capability: { sideEffect: 'external', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true },
                enabled: true,
                provider: 'test-provider'
            };

            const status = detectTrifecta([...module.getRegistry().listToolInfo(), serverTool], egressGated);

            expect(status.severity).toBe('lethal');
            expect(status.privateData).toContain('secret-reader');
            expect(status.untrustedContent).toContain('web_fetch'); // one tool supplies two legs
            expect(status.exfiltrationOpen).toContain('web_fetch');  // no curator gate → open egress
        });

        it('does not flag when the exfiltration leg is disabled', () => {
            register('secret-reader', { sideEffect: 'read', reversible: true, sensitivity: 'secret' });
            register('memo-reader', { sideEffect: 'read', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true });
            register('poster', { sideEffect: 'external', reversible: false, sensitivity: 'public' }); // stays disabled by default

            const status = detectTrifecta(module.getRegistry().listToolInfo(), egressGated);
            expect(status.severity).toBe('safe');
            expect(status.present).toBe(false);
            expect(status.exfiltration).toHaveLength(0);
        });

        it('re-arms to lethal when an admin auto-approves a gated egress', async () => {
            register('secret-reader', { sideEffect: 'read', reversible: true, sensitivity: 'secret' });
            register('memo-reader', { sideEffect: 'read', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true });
            register('curated-poster', { sideEffect: 'external', reversible: false, sensitivity: 'public', forcesCuratorReview: true });
            await module.getRegistry().setEnabled('curated-poster', true);

            // Curator-gated by default → supervised, not lethal.
            expect(detectTrifecta(module.getRegistry().listToolInfo(), egressGated).severity).toBe('supervised');

            // Admin bypass un-gates the egress: the detector re-arms to lethal.
            await module.getPolicy().setOverride('curated-poster', { curation: 'auto-approve' });
            const status = detectTrifecta(module.getRegistry().listToolInfo(), egressGated);
            expect(status.severity).toBe('lethal');
            expect(status.exfiltrationOpen).toContain('curated-poster');
            expect(status.exfiltrationGated).toHaveLength(0);
        });
    });

    describe('curation binding', () => {
        it('rejects a tool that declares curationTypeId without forcesCuratorReview', () => {
            const incoherent: IAiTool = {
                name: 'test-incoherent',
                description: 'binds to a curation type but does not force review',
                inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
                capability: { sideEffect: 'external', reversible: false, sensitivity: 'public', curationTypeId: 'x-poster:tweet' },
                handler: vi.fn(async () => ({}))
            };
            expect(() => module.getRegistry().registerTool(incoherent, 'test')).toThrow(/curationTypeId/);
        });

        it('bars a bound tool on an autonomous run until its curation type is registered', async () => {
            const handler = vi.fn(async () => ({ sent: true }));
            const registry = module.getRegistry();
            registry.registerTool(boundCuratedTool('x-poster:tweet', handler), 'test');
            await registry.setEnabled('test-bound', true); // external ships disabled

            // Binding unresolved (no curation type registered): the verified claim
            // does not hold, so the external tool is barred on the autonomous path.
            const barred = await module.getGovernor().invoke('test-bound', {}, scheduledCtx);
            expect(barred.status).toBe('denied');
            expect(handler).not.toHaveBeenCalled();

            // Register the matching type: the binding resolves and the tool is
            // autonomous-safe (an unattended call can only draft into the queue).
            module.getCuration().registerType(spyCurationType(), 'x-poster');
            const permitted = await module.getGovernor().invoke('test-bound', {}, scheduledCtx);
            expect(permitted.status).toBe('ok');
            expect(handler).toHaveBeenCalledOnce();
        });

        it('re-tightens a bound tool when its curation type is unregistered', async () => {
            const registry = module.getRegistry();
            registry.registerTool(boundCuratedTool('x-poster:tweet'), 'test');
            await registry.setEnabled('test-bound', true);
            const curation = module.getCuration();
            curation.registerType(spyCurationType(), 'x-poster');

            expect((await module.getGovernor().invoke('test-bound', {}, scheduledCtx)).status).toBe('ok');

            // Disabling the owning provider unregisters its type; the binding stops
            // resolving and the tool's autonomous bar returns.
            curation.unregisterType('x-poster:tweet');
            expect((await module.getGovernor().invoke('test-bound', {}, scheduledCtx)).status).toBe('denied');
        });
    });

    describe('curation auto-approve bypass', () => {
        /** A curation-capable tool whose handler drafts one effect into the queue. */
        function holdingTool(curation: CurationService): IAiTool {
            return {
                name: 'test-bound',
                description: 'routes every effect into a core curation type',
                inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
                capability: { sideEffect: 'external', reversible: false, sensitivity: 'public', forcesCuratorReview: true, curationTypeId: 'x-poster:tweet' },
                handler: vi.fn(async () => {
                    await curation.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' } });
                    return { queued: true };
                })
            };
        }

        it('releases a held effect without manual review on the interactive path when policy is auto-approve', async () => {
            const curation = module.getCuration();
            const onApprove = vi.fn(async () => undefined);
            curation.registerType(spyCurationType({ onApprove }), 'x-poster');
            const registry = module.getRegistry();
            registry.registerTool(holdingTool(curation), 'test');
            await registry.setEnabled('test-bound', true);

            // Default (require): the handler runs and drafts, but the effect waits.
            const held = await module.getGovernor().invoke('test-bound', {}, interactiveCtx);
            expect(held.status).toBe('ok');
            expect(onApprove).not.toHaveBeenCalled();
            expect(await curation.countPending()).toBe(1);

            // Admin flips the bypass: the next held effect auto-approves and runs.
            await module.getPolicy().setOverride('test-bound', { curation: 'auto-approve' });
            const released = await module.getGovernor().invoke('test-bound', {}, interactiveCtx);
            expect(released.status).toBe('ok');
            expect(onApprove).toHaveBeenCalledOnce();
        });

        it('ignores auto-approve on autonomous paths — the effect falls back to a manual hold', async () => {
            const curation = module.getCuration();
            const onApprove = vi.fn(async () => undefined);
            curation.registerType(spyCurationType({ onApprove }), 'x-poster');
            const registry = module.getRegistry();
            registry.registerTool(holdingTool(curation), 'test');
            await registry.setEnabled('test-bound', true);
            await module.getPolicy().setOverride('test-bound', { curation: 'auto-approve' });

            // Scheduled run: the tool is autonomous-safe (it self-curates), so it
            // runs and drafts — but the bypass is honoured only on the interactive
            // path, so the effect stays pending for a human.
            const result = await module.getGovernor().invoke('test-bound', {}, scheduledCtx);
            expect(result.status).toBe('ok');
            expect(onApprove).not.toHaveBeenCalled();
            expect(await curation.countPending()).toBe(1);
        });
    });
});

describe('CurationService', () => {
    /** Build a curation service over a fresh mock database. */
    function makeService(): CurationService {
        const logger = createMockLogger();
        const queue = new CurationQueue(logger, createMockDatabaseService());
        return new CurationService(logger, queue);
    }

    it('registers types and reports them', () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');

        expect(service.hasType('x-poster:tweet')).toBe(true);
        expect(service.getType('x-poster:tweet')).toBe(type);
        expect(service.listTypes()).toEqual([{ typeId: 'x-poster:tweet', label: 'Tweet', providerId: 'x-poster' }]);
    });

    it('holds an effect: caches the preview from describe() and stores it pending', async () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');

        const item = await service.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' }, source: 'ai-tool:x-post-tweet' });

        expect(item.status).toBe('pending');
        expect(item.preview.body).toBe('draft p1');
        expect(item.providerId).toBe('x-poster');
        expect(item.source).toBe('ai-tool:x-post-tweet');
        expect(type.describe).toHaveBeenCalledWith({ postId: 'p1' });
        expect(await service.countPending()).toBe(1);
    });

    it('throws when holding for an unregistered type', async () => {
        const service = makeService();
        await expect(service.hold({ typeId: 'nope:thing', ref: {} })).rejects.toThrow(/nope:thing/);
    });

    it('approve records the decision then commits via onApprove', async () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' } });

        const decided = await service.approve(held.id, 'admin-1');

        expect(decided?.status).toBe('approved');
        expect(decided?.decidedBy).toBe('admin-1');
        expect(type.onApprove).toHaveBeenCalledOnce();
        expect(type.onReject).not.toHaveBeenCalled();
        expect(await service.countPending()).toBe(0);
    });

    it('reject records the decision then discards via onReject', async () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        const decided = await service.reject(held.id, 'admin-1');

        expect(decided?.status).toBe('rejected');
        expect(type.onReject).toHaveBeenCalledOnce();
        expect(type.onApprove).not.toHaveBeenCalled();
    });

    it('blocks a decision when the owning type is unregistered, leaving the item pending', async () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        service.unregisterType('x-poster:tweet');
        const decided = await service.approve(held.id, 'admin-1');

        expect(decided).toBeNull();
        expect(type.onApprove).not.toHaveBeenCalled();
        expect(await service.countPending()).toBe(1); // not lost — waits for the owner to return
    });

    it('surfaces a failed commit to the caller while leaving the decision recorded', async () => {
        const service = makeService();
        const type = spyCurationType({ onApprove: vi.fn(async () => { throw new Error('publish failed'); }) });
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        // The commit failure propagates so the curator is not shown a false success...
        await expect(service.approve(held.id, 'admin-1')).rejects.toThrow('publish failed');
        // ...but the decision still stands — the item has left the pending queue.
        expect(await service.countPending()).toBe(0);
    });

    it('resolves a live preview for pending items in listPending and get', async () => {
        const service = makeService();
        let stored = 'v1';
        const type = spyCurationType({ describe: vi.fn(async () => ({ body: stored })) });
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' } });
        expect(held.preview.body).toBe('v1');

        // The provider's record changes out of band; the cached snapshot is stale.
        stored = 'v2';
        expect((await service.listPending())[0].preview.body).toBe('v2');
        expect((await service.get(held.id))?.preview.body).toBe('v2');
    });

    it('edit falls back to the patched body when re-describe fails', async () => {
        const service = makeService();
        let calls = 0;
        const type = spyCurationType({
            describe: vi.fn(async () => {
                calls += 1;
                if (calls === 1) {
                    return { body: 'original', editable: true }; // hold-time snapshot
                }
                throw new Error('describe boom'); // re-describe after the edit
            }),
            applyEdit: vi.fn(async () => undefined)
        });
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        const updated = await service.edit(held.id, { body: 'edited' }, 'admin-1');

        expect(type.applyEdit).toHaveBeenCalledOnce();
        // The edit applied; a failed re-describe must not report failure — fall
        // back to the patched body so the snapshot still advances.
        expect(updated?.preview.body).toBe('edited');
    });

    it('edit applies the patch through the type, then re-derives and re-caches the preview', async () => {
        const service = makeService();
        // Simulate the owning plugin's record: applyEdit mutates it, describe reads it.
        let stored = 'original';
        const type = spyCurationType({
            describe: vi.fn(async () => ({ body: stored, editable: true })),
            applyEdit: vi.fn(async (_item, patch) => { if (typeof patch.body === 'string') stored = patch.body; })
        });
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' } });
        expect(held.preview.body).toBe('original');

        const updated = await service.edit(held.id, { body: 'edited' }, 'admin-1');

        expect(type.applyEdit).toHaveBeenCalledWith(expect.objectContaining({ id: held.id }), { body: 'edited' });
        expect(updated?.preview.body).toBe('edited');
        // The cached snapshot is refreshed too, so the disabled-owner fallback is current.
        expect((await service.get(held.id))?.preview.body).toBe('edited');
        expect(await service.countPending()).toBe(1); // edit does not decide the item
    });

    it('edit returns null for a type that is not editable', async () => {
        const service = makeService();
        service.registerType(spyCurationType(), 'x-poster'); // no applyEdit
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        expect(await service.edit(held.id, { body: 'x' })).toBeNull();
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
