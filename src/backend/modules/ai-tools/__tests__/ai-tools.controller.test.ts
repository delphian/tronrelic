/**
 * @file ai-tools.controller.test.ts
 *
 * Focused controller tests for the per-prompt tool-allowlist wiring: that
 * `savePrompt` forwards a client-supplied `toolAllowlist` into the saved-prompts
 * service (create and update), and that the interactive `query` handler
 * re-validates the selector and forwards a valid one to the active provider.
 * Also covers the streaming path's socket-ownership gate, which decides whether
 * a run may write to the socket its caller named.
 *
 * The controller has twelve constructor dependencies; only `savedPrompts`,
 * `providers`, `history`, `systemPrompts`, and `resolveEndUser` are exercised
 * here, so the rest are inert stubs. The WebSocket singleton is stubbed at the
 * module boundary because the streaming branch consults it for socket ownership
 * before it will start a run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mutable stand-in for the WebSocket singleton the streaming branch consults.
 * `socketOwner` is what `getSocketUserId` reports for any socket id, so a test
 * sets it to the caller's id to simulate owning the socket, to another id to
 * simulate aiming at someone else's browser, and to null for a socket that is
 * unknown or anonymous. Hoisted so the `vi.mock` factory below can close over
 * it despite Vitest lifting the mock above the imports.
 */
const wsMock = vi.hoisted(() => ({
    socketOwner: null as string | null,
    emitToSocket: vi.fn()
}));

vi.mock('../../../services/websocket.service.js', () => ({
    WebSocketService: {
        /**
         * Stand in for the real singleton accessor.
         *
         * @returns A double exposing only the two members the controller calls.
         */
        getInstance: () => ({
            /**
             * Report the configured owner regardless of which socket is asked
             * about — the gate's input, not its lookup, is what these tests vary.
             *
             * @returns The user id currently configured as the socket's owner.
             */
            getSocketUserId: (): string | null => wsMock.socketOwner,
            emitToSocket: wsMock.emitToSocket
        })
    }
}));

import { AiToolsController } from '../api/ai-tools.controller.js';
import { QueryStreamRegistry } from '../services/query-stream-registry.js';

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
        {} as any, // screenConfig
        overrides.queryStreams ?? new QueryStreamRegistry(),
        (async () => undefined) as any // runSavedPromptNow
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

    describe('query (streaming) — socket ownership', () => {
        /**
         * Build a controller whose active provider records every `queryStream`
         * call, so a test can assert the run never started when the gate denies.
         *
         * @returns The controller and the provider double.
         */
        function streamingController() {
            const provider = {
                queryStream: vi.fn(async () => ({ responseText: 'ok' })),
                cancel: vi.fn(() => true)
            };
            const providers = { getActive: vi.fn(() => provider) };
            const { controller } = makeController({ providers });
            return { controller, provider };
        }

        /** A well-formed streaming body; only the caller identity varies below. */
        const STREAM_BODY = { prompt: 'hi', queryId: 'q-1', socketId: 'sock-1' };

        beforeEach(() => {
            wsMock.socketOwner = null;
            wsMock.emitToSocket.mockClear();
        });

        it('starts the run when the named socket is signed in as the caller', async () => {
            const { controller, provider } = streamingController();
            const res = createMockResponse();
            wsMock.socketOwner = 'admin-1';

            await controller.query({ body: STREAM_BODY, userId: 'admin-1' } as any, res);

            expect(res._json).toMatchObject({ success: true, queryId: 'q-1' });
            expect(provider.queryStream).toHaveBeenCalledTimes(1);
        });

        it('refuses a socket signed in as somebody else', async () => {
            const { controller, provider } = streamingController();
            const res = createMockResponse();
            wsMock.socketOwner = 'admin-2';

            await controller.query({ body: STREAM_BODY, userId: 'admin-1' } as any, res);

            expect(res._status).toBe(403);
            expect(provider.queryStream).not.toHaveBeenCalled();
        });

        it('refuses a socket that is unknown or anonymous', async () => {
            const { controller, provider } = streamingController();
            const res = createMockResponse();
            wsMock.socketOwner = null;

            await controller.query({ body: STREAM_BODY, userId: 'admin-1' } as any, res);

            expect(res._status).toBe(403);
            expect(provider.queryStream).not.toHaveBeenCalled();
        });

        it('refuses a service-token call, which owns no socket', async () => {
            // requireAdmin leaves req.userId unset on the service-token path, so
            // there is no identity a socket could be matched against — even a
            // socket that happens to be live belongs to some other person.
            const { controller, provider } = streamingController();
            const res = createMockResponse();
            wsMock.socketOwner = 'admin-1';

            await controller.query({ body: STREAM_BODY } as any, res);

            expect(res._status).toBe(403);
            expect(provider.queryStream).not.toHaveBeenCalled();
        });

        it('leaves the stream registry clean after a refusal, so a retry can claim the id', async () => {
            // The gate runs before the sink is registered; if it did not, the
            // refused queryId would stay claimed and the operator's next attempt
            // would 409 against their own abandoned run.
            const queryStreams = new QueryStreamRegistry();
            const provider = { queryStream: vi.fn(async () => ({ responseText: 'ok' })) };
            const { controller } = makeController({ providers: { getActive: vi.fn(() => provider) }, queryStreams });
            const res = createMockResponse();
            wsMock.socketOwner = 'admin-2';

            await controller.query({ body: STREAM_BODY, userId: 'admin-1' } as any, res);

            expect(res._status).toBe(403);
            expect(queryStreams.register('q-1', () => {})).toBe(true);
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

        /**
         * A provider-hosted `web_fetch`, classified the way a real provider
         * reports one: an untrusted-content ingress and an open external egress
         * at the same time. Two of the three legs in a single tool.
         */
        const HOSTED_FETCH = tool('web_fetch', {
            sideEffect: 'external',
            reversible: true,
            sensitivity: 'internal',
            surfacesUntrustedContent: true
        });

        /**
         * A controller whose active provider reports one hosted tool, so the
         * preview can be asked whether the allowlist gates it.
         *
         * @returns The controller and its doubles.
         */
        function hostedController() {
            return makeController({
                registry: { listToolInfo: vi.fn(() => [SECRET]) },
                policy: { isEgressGated: vi.fn(() => false) },
                promptVariables: { getSecretVariableNames: vi.fn(() => []) },
                providers: {
                    getActive: vi.fn(() => ({ listActiveServerTools: vi.fn(async () => [HOSTED_FETCH]) }))
                }
            });
        }

        it('counts a hosted tool the allowlist grants, completing the trifecta', async () => {
            const { controller } = hostedController();
            const res = createMockResponse();

            // The secret reader plus a granted web_fetch spans all three legs:
            // the hosted tool supplies both the untrusted ingress and the egress.
            await controller.previewTrifecta({ body: { toolAllowlist: ['sec', 'hosted:web_fetch'] } } as any, res);

            expect(res._json.severity).toBe('lethal');
            expect(res._json.exfiltrationOpen).toEqual(['web_fetch']);
        });

        it('drops a hosted tool the allowlist omits, breaking the chain', async () => {
            const { controller } = hostedController();
            const res = createMockResponse();

            // This is the behaviour change: before hosted tools could be named,
            // the same selection still counted web_fetch and reported lethal.
            await controller.previewTrifecta({ body: { toolAllowlist: ['sec'] } } as any, res);

            expect(res._json.severity).toBe('safe');
            expect(res._json.exfiltration).toEqual([]);
        });

        it('still counts hosted tools when no allowlist is given (the global posture)', async () => {
            const { controller } = hostedController();
            const res = createMockResponse();

            // An absent allowlist restricts nothing, so the whole-deployment
            // banner must keep reporting the hosted tool's legs.
            await controller.previewTrifecta({ body: {} } as any, res);

            expect(res._json.severity).toBe('lethal');
        });
    });

    describe('listHostedTools', () => {
        it('asks the named provider about the named model and returns what it reports', async () => {
            const hosted = { name: 'web_search', description: '', inputSchema: { type: 'object' }, enabled: true, provider: 'ai-assistant' };
            const listActiveServerTools = vi.fn(async () => [hosted]);
            const getProvider = vi.fn(() => ({ listActiveServerTools }));
            const { controller } = makeController({ providers: { getProvider, getActive: vi.fn(() => null) } });
            const res = createMockResponse();

            await controller.listHostedTools({ query: { providerId: 'ai-assistant', model: 'claude-opus-4-8' } } as any, res);

            expect(getProvider).toHaveBeenCalledWith('ai-assistant');
            expect(listActiveServerTools).toHaveBeenCalledWith('claude-opus-4-8');
            expect(res._json.tools).toEqual([hosted]);
        });

        it('returns an empty list when no provider can answer', async () => {
            // The picker must degrade to "nothing to grant" rather than erroring:
            // an empty hosted group grants nothing, which is the safe direction.
            const { controller } = makeController({ providers: { getActive: vi.fn(() => null) } });
            const res = createMockResponse();

            await controller.listHostedTools({ query: {} } as any, res);

            expect(res._json.tools).toEqual([]);
        });

        it('returns an empty list when the provider throws', async () => {
            const getActive = vi.fn(() => ({
                listActiveServerTools: vi.fn(async () => { throw new Error('config read failed'); })
            }));
            const { controller } = makeController({ providers: { getActive } });
            const res = createMockResponse();

            await controller.listHostedTools({ query: {} } as any, res);

            expect(res._json.tools).toEqual([]);
        });
    });
});
