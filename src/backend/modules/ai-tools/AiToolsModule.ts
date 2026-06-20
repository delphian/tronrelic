/**
 * @file AiToolsModule.ts
 *
 * Core module owning provider-agnostic AI tool governance: the tool registry,
 * the policy engine, the audit store, the approval queue, and the governor that
 * mediates every tool call. It publishes the registry and governor on the
 * service registry (`'ai-tools'` and `'ai-tool-governor'`) so tool providers
 * register against core — not against any one AI provider plugin — and any AI
 * provider plugin executes through the same governed path.
 *
 * The module is essential infrastructure (the contract every AI tool depends
 * on), so it is a module rather than a plugin and follows the two-phase
 * lifecycle: `init()` constructs services and prepares storage, `run()` mounts
 * the admin router and registers the shared services.
 */

import type { Express } from 'express';
import type {
    IAccountDirectoryService,
    IAiTool,
    IBlockchainObserverService,
    IBlockchainService,
    ICacheService,
    IChainParametersService,
    IDatabaseService,
    IHookRegistry,
    IMenuService,
    IModule,
    IModuleMetadata,
    ISchedulerService,
    IServiceRegistry,
    ISystemConfigService,
    IUsdtParametersService
} from '@/types';
import { logger } from '../../lib/logger.js';
import { getRedisClient } from '../../loaders/redis.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { AiToolRegistry } from './services/ai-tool-registry.js';
import { ToolPolicyEngine, type IRateLimitRedis } from './services/tool-policy-engine.js';
import { ToolAuditStore } from './services/tool-audit-store.js';
import { ToolApprovalQueue } from './services/tool-approval-queue.js';
import { AiToolGovernor } from './services/ai-tool-governor.js';
import { AiProviderRegistry } from './services/ai-provider-registry.js';
import { ScreenConfigService } from './services/screen-config.service.js';
import { AiQueryHistoryService } from './services/ai-query-history.service.js';
import { CurationQueue } from './services/curation-queue.js';
import { CurationService } from './services/curation-service.js';
import { SavedPromptsService } from './services/saved-prompts.service.js';
import { PromptVariableRegistry } from './services/prompt-variable-registry.js';
import { SystemPromptsService } from './services/system-prompts.service.js';
import { registerBuiltinVariables } from './variables/index.js';
import { runScheduledPrompts } from './services/scheduled-prompts-runner.js';
import { createAccountEndUserResolver, type EndUserResolver } from './services/end-user-resolver.js';
import { AiToolsController } from './api/ai-tools.controller.js';
import { createAiToolsAdminRouter } from './api/ai-tools.router.js';

/** Service-registry name for the provider-neutral tool registry. */
export const AI_TOOLS_SERVICE = 'ai-tools';

/** Service-registry name for the tool execution governor. */
export const AI_TOOL_GOVERNOR_SERVICE = 'ai-tool-governor';

/** Service-registry name for the installed-AI-provider registry. */
export const AI_PROVIDERS_SERVICE = 'ai-providers';

/** Service-registry name for the central curation queue. */
export const CURATION_SERVICE = 'curation';

/** Service-registry name for the prompt-variable registry. */
export const PROMPT_VARIABLES_SERVICE = 'prompt-variables';

/** Scheduler job that prunes audit records past the retention window. */
export const AUDIT_PRUNE_JOB = 'ai-tools:prune-audit';

/** Daily (04:00) cron for the audit retention sweep. */
const AUDIT_PRUNE_SCHEDULE = '0 4 * * *';

/** Scheduler job that fires cron-scheduled saved prompts on the master tick. */
export const SCHEDULED_PROMPTS_JOB = 'ai-tools:run-scheduled-prompts';

/**
 * Every 2 minutes (at :00 seconds). The single master tick all scheduled
 * prompts evaluate against — no prompt registers its own job — so this is also
 * the resolution at which a prompt's cron can fire.
 */
const SCHEDULED_PROMPTS_SCHEDULE = '0 */2 * * * *';

/**
 * Dependencies the AI tools module needs at bootstrap. A subset of the shared
 * module dependency bundle, so the bootstrap can inject `sharedDeps` directly.
 */
export interface IAiToolsModuleDependencies {
    /** Core database for tool state, policy overrides, audit, and approvals. */
    database: IDatabaseService;
    /** Service registry to publish the registry and governor on. */
    serviceRegistry: IServiceRegistry;
    /** Hook registry the governor invokes the `ai.toolInvoke`/`ai.toolInvoked` seams through. */
    hookRegistry: IHookRegistry;
    /**
     * Menu service for registering the `/system/ai-tools` admin nav item, and the
     * data source for the built-in `site-info` prompt variable.
     */
    menuService: IMenuService;
    /** Redis-backed cache; data source for the built-in `cache-keys` prompt variable. */
    cacheService: ICacheService;
    /** Block sync reads for the built-in blockchain prompt variables. */
    blockchainService: IBlockchainService;
    /** Observer processing stats for the built-in `observer-stats` prompt variable. */
    observerRegistry: IBlockchainObserverService;
    /** TRON chain parameters for the built-in `chain-params` prompt variable. */
    chainParameters: IChainParametersService;
    /** USDT transfer energy costs for the built-in `chain-params` prompt variable. */
    usdtParameters: IUsdtParametersService;
    /** Runtime site config for the built-in `site-info` prompt variable. */
    systemConfig: ISystemConfigService;
    /** Express app the admin router mounts onto. */
    app: Express;
    /**
     * Scheduler for the audit retention sweep. Optional/nullable so tests and a
     * scheduler-disabled deployment still boot the module; when absent the prune
     * job simply is not registered and the audit collection is not auto-trimmed.
     */
    scheduler?: ISchedulerService | null;
}

/**
 * The AI tool governance module.
 */
export class AiToolsModule implements IModule<IAiToolsModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'ai-tools',
        name: 'AI Tools',
        version: '1.0.0',
        description: 'Provider-agnostic AI tool registry, governor, policy, audit, and approval queue'
    };

    private database!: IDatabaseService;
    private serviceRegistry!: IServiceRegistry;
    private hookRegistry!: IHookRegistry;
    private menuService!: IMenuService;
    private cacheService!: ICacheService;
    private blockchainService!: IBlockchainService;
    private observerRegistry!: IBlockchainObserverService;
    private chainParameters!: IChainParametersService;
    private usdtParameters!: IUsdtParametersService;
    private systemConfig!: ISystemConfigService;
    private app!: Express;
    private scheduler: ISchedulerService | null = null;

    private registry!: AiToolRegistry;
    private policy!: ToolPolicyEngine;
    private audit!: ToolAuditStore;
    private approvals!: ToolApprovalQueue;
    private curationQueue!: CurationQueue;
    private curation!: CurationService;
    private governor!: AiToolGovernor;
    private providerRegistry!: AiProviderRegistry;
    private screenConfig!: ScreenConfigService;
    private queryHistory!: AiQueryHistoryService;
    private savedPrompts!: SavedPromptsService;
    private promptVariables!: PromptVariableRegistry;
    private systemPrompts!: SystemPromptsService;
    private resolveEndUser!: EndUserResolver;
    private controller!: AiToolsController;

    private readonly logger = logger.child({ module: 'ai-tools' });

    /**
     * Construct services and prepare storage. Does not mount routes or publish
     * services — that happens in `run()`.
     *
     * @param dependencies - Injected core infrastructure.
     */
    async init(dependencies: IAiToolsModuleDependencies): Promise<void> {
        this.logger.info('Initializing ai-tools module...');

        this.database = dependencies.database;
        this.serviceRegistry = dependencies.serviceRegistry;
        this.hookRegistry = dependencies.hookRegistry;
        this.menuService = dependencies.menuService;
        this.cacheService = dependencies.cacheService;
        this.blockchainService = dependencies.blockchainService;
        this.observerRegistry = dependencies.observerRegistry;
        this.chainParameters = dependencies.chainParameters;
        this.usdtParameters = dependencies.usdtParameters;
        this.systemConfig = dependencies.systemConfig;
        this.app = dependencies.app;
        this.scheduler = dependencies.scheduler ?? null;

        this.registry = new AiToolRegistry(this.logger, this.database);
        await this.registry.loadStates();

        // Back the rate/cost windows with Redis so the limits are one shared
        // budget across backend instances and survive a restart. getRedisClient
        // throws if Redis is not initialized (e.g. a test boot); the engine then
        // degrades to per-instance in-memory counters rather than failing.
        let rateLimitRedis: IRateLimitRedis | undefined;
        try {
            rateLimitRedis = getRedisClient();
        } catch (error) {
            this.logger.warn({ error }, 'Redis unavailable at init; AI tool rate/cost limits will be per-instance in-memory');
        }

        // The provider-neutral, _kv-backed untrusted-content screen policy. Loaded
        // before the policy engine and governor because both read it — the policy
        // engine for the offender threshold, the governor on every screen decision.
        this.screenConfig = new ScreenConfigService(this.logger, this.database);
        await this.screenConfig.load();

        // Constructed here (ahead of the governor) so the governor's screen deps
        // can hold it; it stays empty until a provider plugin registers at runtime.
        this.providerRegistry = new AiProviderRegistry(this.logger);

        this.policy = new ToolPolicyEngine(this.logger, this.database, rateLimitRedis, this.screenConfig);
        await this.policy.loadOverrides();

        this.audit = new ToolAuditStore(this.logger, this.database);
        await this.audit.ensureIndexes();

        this.approvals = new ToolApprovalQueue(this.logger, this.database);
        await this.approvals.ensureIndexes();

        this.curationQueue = new CurationQueue(this.logger, this.database);
        await this.curationQueue.ensureIndexes();
        this.curation = new CurationService(this.logger, this.curationQueue);

        // Verify a tool's `curationTypeId` binding against the live curation
        // registry. A declared binding relaxes the tool's gates only while its
        // owning type is registered, and re-tightens the moment that owner is
        // disabled — verification rather than the honour-system boolean alone.
        this.policy.setCurationResolver((typeId) => this.curation.hasType(typeId));

        this.governor = new AiToolGovernor(this.logger, this.registry, this.policy, this.audit, this.approvals, this.hookRegistry, {
            config: this.screenConfig,
            providers: this.providerRegistry,
            isEgressReachable: () => this.isEgressReachable()
        });

        this.queryHistory = new AiQueryHistoryService(this.logger, this.database);
        await this.queryHistory.ensureIndexes();

        this.savedPrompts = new SavedPromptsService(this.database);
        await this.savedPrompts.ensureIndexes();

        this.promptVariables = new PromptVariableRegistry(this.logger, this.database);
        await this.promptVariables.load();

        // Core-owned system prompts (always-on master + audience-scoped
        // additional prompts) composed into every query's injected system
        // prompt. Internal to the module — consumed only by the query controller
        // and the scheduled-prompts runner, so it is not published on the
        // service registry. Depends on the prompt-variable registry to expand
        // `{%name%}` tokens in the composed prompt.
        this.systemPrompts = new SystemPromptsService(this.database, this.promptVariables);
        await this.systemPrompts.ensureIndexes();

        // Register the core-owned built-in dynamic variables. Lifted out of the
        // trp-ai-assistant plugin so the variables exist for whichever AI provider
        // is installed (or none) and the lethal-trifecta detector always sees them.
        // The resolvers read these injected services lazily at expansion time.
        registerBuiltinVariables(this.promptVariables, {
            blockchainService: this.blockchainService,
            chainParameters: this.chainParameters,
            usdtParameters: this.usdtParameters,
            observerRegistry: this.observerRegistry,
            systemLog: this.logger,
            systemConfig: this.systemConfig,
            menuService: this.menuService,
            cache: this.cacheService
        });

        // Register the core-owned built-in tools. `send-toast` was lifted out of
        // the trp-ai-assistant plugin so the site-wide announcement capability is
        // provider-neutral — it exists for whichever AI provider is installed, or
        // none, and survives a provider swap.
        this.registerBuiltinTools();

        // Resolve a Better Auth user id to a live end-user principal via the
        // identity module's 'accounts' service, read lazily so the boot-order
        // race (identity registers 'accounts' in its own run()) and operator
        // churn are both tolerated. Drives interactive-query attribution and
        // scheduled-prompt on-behalf-of execution.
        this.resolveEndUser = createAccountEndUserResolver(
            () => this.serviceRegistry.get<IAccountDirectoryService>('accounts')
        );

        this.controller = new AiToolsController(this.registry, this.policy, this.audit, this.approvals, this.governor, this.providerRegistry, this.curation, this.queryHistory, this.savedPrompts, this.promptVariables, this.systemPrompts, this.resolveEndUser, this.screenConfig);

        this.logger.info('ai-tools module initialized');
    }

    /**
     * Register the core-owned built-in AI tools on the registry.
     *
     * Today this is `send-toast`: a site-wide UI announcement broadcast. It is
     * classified external / reversible / public, so the registry's
     * capability-driven default-deny ships it disabled until an operator opts in,
     * and the governor rate-governs it like any other external tool. Lifted from
     * the trp-ai-assistant plugin so the capability is provider-neutral — it does
     * not vanish when the Anthropic transport is swapped for another provider.
     * The handler broadcasts on the global `'toast'` WebSocket event, surfaced in
     * every browser by the core `CoreToastHandler` component; `WebSocketService`
     * is resolved lazily at call time and its emit is a no-op when WebSockets are
     * disabled, so registration never depends on socket availability.
     */
    private registerBuiltinTools(): void {
        const sendToast: IAiTool = {
            name: 'send-toast',
            description:
                'Broadcast a system-wide toast notification to EVERY connected browser session — all users, ' +
                'not just the person who sent this query. This is a public site-wide announcement mechanism. ' +
                'Never use this to answer the user\'s question, relay query findings, or communicate normal responses — ' +
                'write those as regular text in the conversation instead. ' +
                'Appropriate uses: site restarts, maintenance windows, critical system alerts, or global status changes ' +
                'that every visitor should see regardless of who they are or what page they are on. ' +
                'Toasts appear as small pop-ups in the bottom-right corner and auto-dismiss after a few seconds. ' +
                'Keep title under 60 characters and description under 120. ' +
                'Do NOT call this tool multiple times in rapid succession.',
            inputSchema: {
                type: 'object',
                description: 'Toast notification content and presentation options',
                properties: {
                    title: { type: 'string', description: 'Short toast title, under 60 characters (required)' },
                    description: { type: 'string', description: 'Optional longer description, under 120 characters' },
                    tone: { type: 'string', enum: ['info', 'success', 'warning', 'danger'], description: 'Visual tone. Use info for neutral, success for confirmations, warning for caution, danger for errors. Defaults to info.' },
                    duration: { type: 'number', description: 'Auto-dismiss duration in milliseconds. Defaults to 6000. Use 0 for persistent toasts that require manual dismissal.' }
                },
                required: ['title'],
                additionalProperties: false
            },
            capability: { sideEffect: 'external', reversible: true, sensitivity: 'public' },
            handler: async (input) => {
                // Re-validate model input: the schema is a hint, not a guarantee.
                const payload = input as {
                    tone?: 'info' | 'success' | 'warning' | 'danger';
                    title?: unknown;
                    description?: unknown;
                    duration?: unknown;
                };
                const title = typeof payload.title === 'string' ? payload.title.trim() : '';
                if (!title) {
                    return { success: false, error: 'title is required and must be a non-empty string' };
                }
                const tone = payload.tone && ['info', 'success', 'warning', 'danger'].includes(payload.tone)
                    ? payload.tone
                    : 'info';
                const duration = typeof payload.duration === 'number' && Number.isFinite(payload.duration) && payload.duration >= 0
                    ? payload.duration
                    : 6000;

                WebSocketService.getInstance().emit({
                    event: 'toast',
                    payload: {
                        tone,
                        title,
                        description: typeof payload.description === 'string' ? payload.description.trim() || undefined : undefined,
                        duration
                    }
                });

                return { success: true, sent: true };
            }
        };

        this.registry.registerTool(sendToast, 'core');
    }

    /**
     * Mount the admin router and publish the registry and governor on the
     * service registry for tool providers and AI provider plugins.
     */
    async run(): Promise<void> {
        this.logger.info('Running ai-tools module...');

        this.app.use('/api/admin/system/ai-tools', createAiToolsAdminRouter(this.controller));

        // Surface governed events to the admin dashboard as lightweight refetch
        // signals. WebSocketService is initialised earlier in bootstrap; when
        // WebSockets are disabled its emit is a no-op, so governance still runs.
        this.governor.setBroadcast((event, payload) => {
            WebSocketService.getInstance().emit({ event, payload });
        });

        // Curation decisions and new holds nudge the dashboard to refetch, the
        // same lightweight signal the governor uses for approvals.
        this.curation.setBroadcast((event, payload) => {
            WebSocketService.getInstance().emit({ event, payload });
        });

        this.serviceRegistry.register(AI_TOOLS_SERVICE, this.registry);
        this.serviceRegistry.register(AI_TOOL_GOVERNOR_SERVICE, this.governor);
        this.serviceRegistry.register(AI_PROVIDERS_SERVICE, this.providerRegistry);
        this.serviceRegistry.register(CURATION_SERVICE, this.curation);
        this.serviceRegistry.register(PROMPT_VARIABLES_SERVICE, this.promptVariables);

        // Daily audit retention sweep. A Mongo TTL index can't enforce this —
        // `createdAt` is an ISO string, not a Date — so retention is a scheduled
        // range delete. SchedulerService supports late registration; the
        // scheduler module starts ticking after every module's run().
        if (this.scheduler) {
            this.scheduler.register(AUDIT_PRUNE_JOB, AUDIT_PRUNE_SCHEDULE, async () => {
                await this.audit.pruneExpired();
            });
            this.logger.info({ job: AUDIT_PRUNE_JOB }, 'AI tool audit retention job registered');

            // Cron-scheduled saved prompts. Every prompt with a cron evaluates on
            // this single master tick — no prompt registers its own job. The run
            // is autonomous, so it executes against whichever AI provider is
            // active, resolved fresh each tick from the provider registry; with
            // no provider installed the tick is a no-op and the prompts (and
            // their schedules) wait, untouched, until one is enabled.
            let promptTickInFlight = false;
            let promptTickStartedAt = 0;
            this.scheduler.register(SCHEDULED_PROMPTS_JOB, SCHEDULED_PROMPTS_SCHEDULE, async () => {
                // Skip overlapping ticks: a streaming provider query can take
                // minutes, and re-entering with the same saved-prompts snapshot
                // would duplicate-fire prompts the first tick hasn't claimed yet.
                if (promptTickInFlight) {
                    this.logger.error(
                        { job: SCHEDULED_PROMPTS_JOB, runningForMs: Date.now() - promptTickStartedAt },
                        'Scheduled prompts tick still running when next tick fired; skipping this tick'
                    );
                    return;
                }
                // Cheap no-op when nothing is installed at all. A prompt may pin a
                // specific (possibly inactive) provider, so don't gate on an
                // *active* provider — only on there being no provider registered
                // whatsoever. The resolver below routes each prompt per its
                // providerId, falling back to the active provider when unpinned.
                if (this.providerRegistry.listProviders().length === 0) {
                    return;
                }
                promptTickInFlight = true;
                promptTickStartedAt = Date.now();
                try {
                    await runScheduledPrompts(
                        this.savedPrompts,
                        this.logger,
                        (providerId) => providerId
                            ? this.providerRegistry.getProvider(providerId)
                            : this.providerRegistry.getActive(),
                        this.resolveEndUser,
                        (principal) => this.systemPrompts.compose(principal)
                    );
                } catch (error) {
                    this.logger.error({ error, job: SCHEDULED_PROMPTS_JOB }, 'Scheduled prompts job failed');
                    throw error;
                } finally {
                    promptTickInFlight = false;
                }
            });
            this.logger.info({ job: SCHEDULED_PROMPTS_JOB }, 'AI tool scheduled-prompts job registered');
        } else {
            this.logger.info('Scheduler disabled — AI tool audit retention and scheduled-prompts jobs not registered');
        }

        // Admin nav item under the System container. Memory-only (re-created each
        // boot); the parent-chain walk forces `requiresAdmin` on it.
        await this.menuService.create({
            namespace: 'main',
            label: 'AI Tools',
            url: '/system/ai-tools',
            icon: 'Wrench',
            order: 36,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });

        this.logger.info(
            { services: [AI_TOOLS_SERVICE, AI_TOOL_GOVERNOR_SERVICE, AI_PROVIDERS_SERVICE, CURATION_SERVICE, PROMPT_VARIABLES_SERVICE] },
            'ai-tools module running (admin router mounted, services registered)'
        );
    }

    /**
     * Whether an external egress sink is currently reachable — the signal the
     * governor's `trifecta`-posture screen gates on. True when any enabled
     * registry tool is `external` (a governed sink the model can drive) or the
     * active provider exposes a server-side tool (Anthropic's `web_fetch` — an
     * un-governed egress). When neither exists, injected instructions have
     * nowhere to send data, so the screen can safely skip the result.
     *
     * Mirrors the egress half of the lethal-trifecta detector deliberately: the
     * screen defends exactly the configurations the trifecta banner calls armed.
     * A provider read that throws degrades to "registry-only" rather than
     * forcing the screen off — fail safe toward screening.
     *
     * @returns True when an exfiltration channel is enabled.
     */
    private async isEgressReachable(): Promise<boolean> {
        const externalEnabled = this.registry.getEnabledTools().some(t => t.capability?.sideEffect === 'external');
        if (externalEnabled) {
            return true;
        }
        const provider = this.providerRegistry.getActive();
        if (provider && typeof provider.listActiveServerTools === 'function') {
            try {
                const serverTools = await provider.listActiveServerTools();
                if (serverTools.length > 0) {
                    return true;
                }
            } catch (error) {
                this.logger.warn({ error }, 'Egress-posture probe: provider server-tool lookup failed; treating as registry-only');
            }
        }
        return false;
    }

    /**
     * The tool governor, for tests and in-process consumers.
     *
     * @returns The governor instance.
     * @throws If called before `init()`.
     */
    getGovernor(): AiToolGovernor {
        if (!this.governor) {
            throw new Error('AiToolsModule not initialized - call init() first');
        }
        return this.governor;
    }

    /**
     * The provider registry, for tests and in-process consumers — e.g. a test
     * that installs a fake active provider to exercise the untrusted-content
     * screen path the governor routes through it.
     *
     * @returns The provider registry instance.
     * @throws If called before `init()`.
     */
    getProviderRegistry(): AiProviderRegistry {
        if (!this.providerRegistry) {
            throw new Error('AiToolsModule not initialized - call init() first');
        }
        return this.providerRegistry;
    }

    /**
     * The untrusted-content screen config service, for tests and in-process
     * consumers that need to toggle the screen's master switch or posture.
     *
     * @returns The screen config service instance.
     * @throws If called before `init()`.
     */
    getScreenConfig(): ScreenConfigService {
        if (!this.screenConfig) {
            throw new Error('AiToolsModule not initialized - call init() first');
        }
        return this.screenConfig;
    }

    /**
     * The tool registry, for tests and in-process consumers.
     *
     * @returns The registry instance.
     * @throws If called before `init()`.
     */
    getRegistry(): AiToolRegistry {
        if (!this.registry) {
            throw new Error('AiToolsModule not initialized - call init() first');
        }
        return this.registry;
    }

    /**
     * The curation service, for tests and in-process consumers.
     *
     * @returns The curation service instance.
     * @throws If called before `init()`.
     */
    getCuration(): CurationService {
        if (!this.curation) {
            throw new Error('AiToolsModule not initialized - call init() first');
        }
        return this.curation;
    }

    /**
     * The policy engine, for tests and in-process consumers — notably the
     * trifecta detector, which credits the same egress-gating fact the engine
     * enforces on autonomous paths.
     *
     * @returns The policy engine instance.
     * @throws If called before `init()`.
     */
    getPolicy(): ToolPolicyEngine {
        if (!this.policy) {
            throw new Error('AiToolsModule not initialized - call init() first');
        }
        return this.policy;
    }

    /**
     * The prompt-variable registry, for tests and in-process consumers (the AI
     * provider plugin resolves `{%name%}` patterns through it).
     *
     * @returns The prompt-variable registry instance.
     * @throws If called before `init()`.
     */
    getPromptVariables(): PromptVariableRegistry {
        if (!this.promptVariables) {
            throw new Error('AiToolsModule not initialized - call init() first');
        }
        return this.promptVariables;
    }
}
