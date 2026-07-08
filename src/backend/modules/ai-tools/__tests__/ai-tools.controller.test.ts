/**
 * @file ai-tools.controller.test.ts
 *
 * Focused controller tests for the per-prompt tool-allowlist wiring: that
 * `savePrompt` forwards a client-supplied `toolAllowlist` into the saved-prompts
 * service (create and update), and that the interactive `query` handler
 * re-validates the selector and forwards a valid one to the active provider.
 *
 * The controller has twelve constructor dependencies; only `savedPrompts`,
 * `providers`, `history`, `systemPrompts`, and `resolveEndUser` are exercised
 * here, so the rest are inert stubs. Only the non-streaming query path is
 * driven, keeping the WebSocket singleton (used exclusively by the streaming
 * branch) out of scope.
 */

import { describe, it, expect, vi } from 'vitest';
import { AiToolsController } from '../api/ai-tools.controller.js';

/**
 * Build a mock Express response capturing status + json.
 *
 * @returns A response double with `_status` / `_json` accessors and spies.
 */
function createMockResponse() {
    const res: any = {
        _status: 200,
        _json: undefined as unknown,
        status: vi.fn((code: number) => {
            res._status = code;
            return res;
        }),
        json: vi.fn((body: unknown) => {
            res._json = body;
            return res;
        })
    };
    return res;
}

/**
 * Construct the controller with inert stubs, overriding only the dependencies a
 * given test needs.
 *
 * @param overrides - Partial map of the named dependencies to inject.
 * @returns The controller plus the resolved dependency doubles.
 */
function makeController(overrides: Record<string, any> = {}) {
    const savedPrompts = overrides.savedPrompts ?? {
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
        list: vi.fn(async () => [])
    };
    const providers = overrides.providers ?? { getActive: vi.fn(() => null) };
    const history = overrides.history ?? { append: vi.fn(async () => {}) };
    const systemPrompts = overrides.systemPrompts ?? { compose: vi.fn(async () => 'SYS') };
    const resolveEndUser = overrides.resolveEndUser ?? vi.fn(async () => null);
    const registry = overrides.registry ?? { listToolInfo: vi.fn(() => []) };
    const policy = overrides.policy ?? { isEgressGated: vi.fn(() => false) };
    const promptVariables = overrides.promptVariables ?? { getSecretVariableNames: vi.fn(() => []) };

    const controller = new AiToolsController(
        registry as any,
        policy as any,
        {} as any, // audit
        {} as any, // approvals
        {} as any, // governor
        providers as any,
        history as any,
        savedPrompts as any,
        promptVariables as any,
        systemPrompts as any,
        resolveEndUser as any,
        {} as any // screenConfig
    );

    return { controller, savedPrompts, providers, history, systemPrompts, resolveEndUser, registry, policy, promptVariables };
}

describe('AiToolsController — toolAllowlist wiring', () => {
    describe('savePrompt', () => {
        it('forwards toolAllowlist to create on a new prompt', async () => {
            const { controller, savedPrompts } = makeController();
            const req: any = { body: { name: 'N', prompt: 'P', toolAllowlist: ['a', 'b'] }, userId: 'admin-1' };
            const res = createMockResponse();

            await controller.savePrompt(req, res);

            expect(savedPrompts.create).toHaveBeenCalledTimes(1);
            expect(savedPrompts.create.mock.calls[0][0]).toMatchObject({ toolAllowlist: ['a', 'b'] });
        });

        it('forwards toolAllowlist to update on an existing prompt (incl. [] and null)', async () => {
            const { controller, savedPrompts } = makeController();
            const res = createMockResponse();

            await controller.savePrompt({ body: { id: 'p1', toolAllowlist: [] } } as any, res);
            expect(savedPrompts.update.mock.calls[0][1]).toMatchObject({ toolAllowlist: [] });

            await controller.savePrompt({ body: { id: 'p1', toolAllowlist: null } } as any, res);
            expect(savedPrompts.update.mock.calls[1][1]).toMatchObject({ toolAllowlist: null });
        });

        it('maps a service SavedPromptValidationError to its status code', async () => {
            // A malformed allowlist is rejected by the service's validator; the
            // controller's existing catch maps SavedPromptValidationError → 400.
            const { SavedPromptValidationError } = await import('../services/saved-prompts.service.js');
            const savedPrompts = {
                create: vi.fn(async () => { throw new SavedPromptValidationError('toolAllowlist must be an array of tool-name strings'); }),
                update: vi.fn(),
                list: vi.fn(async () => [])
            };
            const { controller } = makeController({ savedPrompts });
            const res = createMockResponse();

            await controller.savePrompt({ body: { name: 'N', prompt: 'P', toolAllowlist: 'nope' } } as any, res);

            expect(res._status).toBe(400);
        });
    });

    describe('query (non-streaming)', () => {
        it('rejects a non-array toolAllowlist with 400 before touching the provider', async () => {
            const provider = { query: vi.fn(async (_opts: any) => ({ responseText: 'ok' })) };
            const providers = { getActive: vi.fn(() => provider) };
            const { controller } = makeController({ providers });
            const res = createMockResponse();

            await controller.query({ body: { prompt: 'hi', stream: false, toolAllowlist: 'all' } } as any, res);

            expect(res._status).toBe(400);
            expect(provider.query).not.toHaveBeenCalled();
        });

        it('rejects an allowlist with a non-string entry with 400', async () => {
            const provider = { query: vi.fn(async (_opts: any) => ({ responseText: 'ok' })) };
            const providers = { getActive: vi.fn(() => provider) };
            const { controller } = makeController({ providers });
            const res = createMockResponse();

            await controller.query({ body: { prompt: 'hi', stream: false, toolAllowlist: ['ok', 7] } } as any, res);

            expect(res._status).toBe(400);
            expect(provider.query).not.toHaveBeenCalled();
        });

        it('rejects an allowlist with a blank / whitespace-only entry with 400', async () => {
            const provider = { query: vi.fn(async (_opts: any) => ({ responseText: 'ok' })) };
            const providers = { getActive: vi.fn(() => provider) };
            const { controller } = makeController({ providers });
            const res = createMockResponse();

            await controller.query({ body: { prompt: 'hi', stream: false, toolAllowlist: ['ok', '  '] } } as any, res);

            expect(res._status).toBe(400);
            expect(provider.query).not.toHaveBeenCalled();
        });

        it('rejects an allowlist entry with leading/trailing whitespace with 400', async () => {
            const provider = { query: vi.fn(async (_opts: any) => ({ responseText: 'ok' })) };
            const providers = { getActive: vi.fn(() => provider) };
            const { controller } = makeController({ providers });
            const res = createMockResponse();

            await controller.query({ body: { prompt: 'hi', stream: false, toolAllowlist: [' padded '] } } as any, res);

            expect(res._status).toBe(400);
            expect(provider.query).not.toHaveBeenCalled();
        });

        it('forwards a valid toolAllowlist to the provider query', async () => {
            const provider = { query: vi.fn(async (_opts: any) => ({ responseText: 'ok' })) };
            const providers = { getActive: vi.fn(() => provider) };
            const { controller } = makeController({ providers });
            const res = createMockResponse();

            await controller.query({ body: { prompt: 'hi', stream: false, toolAllowlist: ['tool-x'] } } as any, res);

            expect(provider.query).toHaveBeenCalledTimes(1);
            expect(provider.query.mock.calls[0][0]).toMatchObject({ prompt: 'hi', toolAllowlist: ['tool-x'] });
        });

        it('omits toolAllowlist (undefined → all tools) when the body has none', async () => {
            const provider = { query: vi.fn(async (_opts: any) => ({ responseText: 'ok' })) };
            const providers = { getActive: vi.fn(() => provider) };
            const { controller } = makeController({ providers });
            const res = createMockResponse();

            await controller.query({ body: { prompt: 'hi', stream: false } } as any, res);

            expect(provider.query).toHaveBeenCalledTimes(1);
            expect(provider.query.mock.calls[0][0].toolAllowlist).toBeUndefined();
        });
    });

    describe('previewTrifecta', () => {
        /**
         * Build a minimal enabled tool-info double with the given capability.
         *
         * @param name - Tool name.
         * @param cap - Capability flags driving trifecta legs.
         * @returns An IAiToolInfo-shaped object.
         */
        function tool(name: string, cap: Record<string, unknown>): any {
            return { name, description: '', inputSchema: { type: 'object' }, capability: cap, enabled: true, provider: 'core' };
        }

        const SECRET = tool('sec', { sideEffect: 'read', reversible: true, sensitivity: 'secret' });
        const UNTRUSTED = tool('web', { sideEffect: 'read', reversible: true, sensitivity: 'public', surfacesUntrustedContent: true });
        const EXTERNAL = tool('post', { sideEffect: 'external', reversible: false, sensitivity: 'public' });

        /**
         * A controller whose registry exposes the three trifecta-leg tools, no
         * provider server tools, and no secret variables — so the verdict is
         * driven entirely by the previewed allowlist.
         *
         * @returns The controller and its doubles.
         */
        function trifectaController() {
            return makeController({
                registry: { listToolInfo: vi.fn(() => [SECRET, UNTRUSTED, EXTERNAL]) },
                policy: { isEgressGated: vi.fn(() => false) }, // egress is open
                promptVariables: { getSecretVariableNames: vi.fn(() => []) },
                providers: { getActive: vi.fn(() => null) }
            });
        }

        it('rejects a malformed toolAllowlist with 400', async () => {
            const { controller } = trifectaController();
            const res = createMockResponse();

            await controller.previewTrifecta({ body: { toolAllowlist: 'nope' } } as any, res);

            expect(res._status).toBe(400);
        });

        it('reports lethal when the allowlist spans all three legs with open egress', async () => {
            const { controller } = trifectaController();
            const res = createMockResponse();

            await controller.previewTrifecta({ body: { toolAllowlist: ['sec', 'web', 'post'] } } as any, res);

            expect(res._json.severity).toBe('lethal');
        });

        it('reports safe when the allowlist drops the egress leg', async () => {
            const { controller } = trifectaController();
            const res = createMockResponse();

            // Narrowing away the external tool breaks the chain — exactly the
            // opt-in-narrowing behaviour the per-run badge exists to surface.
            await controller.previewTrifecta({ body: { toolAllowlist: ['sec', 'web'] } } as any, res);

            expect(res._json.severity).toBe('safe');
            expect(res._json.exfiltration).toEqual([]);
        });

        it('reports safe for an empty allowlist (no governed tools in play)', async () => {
            const { controller } = trifectaController();
            const res = createMockResponse();

            await controller.previewTrifecta({ body: { toolAllowlist: [] } } as any, res);

            expect(res._json.severity).toBe('safe');
        });
    });
});
