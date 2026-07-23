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
    IContentPublishedContext,
    IBlockchainObserverService,
    IBlockchainService,
    ICacheService,
    IChainParametersService,
    IContentRegistry,
    ICurationService,
    IDatabaseService,
    IHookRegistry,
    IMenuService,
    IModule,
    IModuleMetadata,
    INotificationService,
    ISchedulerService,
    IServiceRegistry,
    ISystemConfigService,
    IUsdtParametersService
} from '@/types';
import { ADMIN_GROUP_ID } from '@/types';
import { logger } from '../../lib/logger.js';
import { HOOKS } from '../../hooks/registry.js';
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
import { CONTENT_TYPES_SERVICE } from '../../services/content-registry.js';
import { SavedPromptsService } from './services/saved-prompts.service.js';
import { PromptVariableRegistry } from './services/prompt-variable-registry.js';
import { SystemPromptsService } from './services/system-prompts.service.js';
import { registerBuiltinVariables } from './variables/index.js';
import { runScheduledPrompts, type ScheduledPromptNotifier } from './services/scheduled-prompts-runner.js';
import { executeSavedPrompt, type ISavedPromptExecutionDeps } from './services/execute-saved-prompt.js';
import { createAccountEndUserResolver, type EndUserResolver } from './services/end-user-resolver.js';
import { AiToolsController } from './api/ai-tools.controller.js';
import { createAiToolsAdminRouter } from './api/ai-tools.router.js';
import { SocialPostStore } from './services/social-post-store.js';
import { createSocialPostCurationType, createSocialPostTool } from './social-post.js';
import { createWebFetchTool } from './web-fetch.js';

/** Service-registry name for the provider-neutral tool registry. */
export const AI_TOOLS_SERVICE = 'ai-tools';

/** Service-registry name for the tool execution governor. */
export const AI_TOOL_GOVERNOR_SERVICE = 'ai-tool-governor';

/** Service-registry name for the installed-AI-provider registry. */
export const AI_PROVIDERS_SERVICE = 'ai-providers';

/**
 * Service-registry name of the central curation service (owned by the curation
 * module). Held as a local literal — not imported from that module — so ai-tools
 * stays decoupled from its source; the only contract between them is this name,
 * the `ICurationService` interface, and `runWithCurationAutoApprove` (imported by
 * the governor). The governor verifies a tool's `curationTypeId` binding against
 * this service.
 */
const CURATION_SERVICE = 'curation';

/** Service-registry name for the prompt-variable registry. */
export const PROMPT_VARIABLES_SERVICE = 'prompt-variables';

/** Scheduler job that prunes audit records past the retention window. */
export const AUDIT_PRUNE_JOB = 'ai-tools:prune-audit';

/** Daily (04:00) cron for the audit retention sweep. */
const AUDIT_PRUNE_SCHEDULE = '0 4 * * *';

/** Scheduler job that fires cron-scheduled saved prompts on the master tick. */
export const SCHEDULED_PROMPTS_JOB = 'ai-tools:run-scheduled-prompts';

/**
 * Notification category id for scheduled-prompt run outcomes. Registered on the
 * `'notifications'` service in run(); every cron-prompt run fans a toast to
 * admins through it, and any admin can silence it from their preferences.
 */
const SCHEDULED_PROMPT_NOTIFY_CATEGORY = 'ai-tools.scheduled-prompt-run';

/**
 * Content type id this module registers on the central content registry for the
 * scheduled-prompt notification. `notify()` carries the run's title/body by
 * reference under this type; its `describe(ref)` echoes them into a descriptor —
 * the notification path consumes the same content registry as curation.
 */
const SCHEDULED_PROMPT_CONTENT_TYPE = 'ai-tools:scheduled-prompt-run';

/**
 * Service-registry name of the notifications service this module fires through.
 * Held as a local literal rather than imported from the notifications module so
 * ai-tools stays decoupled from that module's source — the only contract
 * between them is the registry name and the `INotificationService` interface.
 */
const NOTIFICATIONS_SERVICE = 'notifications';

/**
 * Every 2 minutes (at :00 seconds). The single master tick all scheduled
 * prompts evaluate against — no prompt registers its own job — so this is also
 * the resolution at which a prompt's cron can fire.
 */
const SCHEDULED_PROMPTS_SCHEDULE = '0 */2 * * * *';

/**
 * The hook seams a saved prompt's `kind: 'hook'` trigger may bind to, each with
 * a mapper that flattens its payload into the `{%hook.*%}` variables the
 * executor substitutes into the prompt text. Deliberately an explicit
 * allowlist — not "every declared hook" — because binding only makes sense on
 * observer seams whose payload a prompt can consume as text; the saved-prompts
 * service validates a trigger's `hookId` against exactly this set.
 */
const BINDABLE_HOOKS = [
    {
        descriptor: HOOKS.content.published,
        /**
         * Flatten a `content.published` payload into per-run prompt variables:
         * the owning type id, the opaque ref (JSON), the full decision-time
         * descriptor (JSON), and its title/body for prompts that only need the
         * rendered snapshot.
         *
         * @param ctx - The hook payload carried by the firing.
         * @returns The `{%hook.*%}` variable map for this run.
         */
        toVariables: (ctx: IContentPublishedContext): Record<string, string> => ({
            'hook.type-id': ctx.typeId,
            'hook.ref': JSON.stringify(ctx.ref),
            'hook.descriptor': JSON.stringify(ctx.descriptor),
            'hook.title': ctx.descriptor.title ?? '',
            'hook.body': ctx.descriptor.body ?? ''
        }),
        /**
         * Extract the payload's content-type id so a trigger's optional
         * `typeIdFilter` can scope the binding to one published type.
         *
         * @param ctx - The hook payload carried by the firing.
         * @returns The owning content type id.
         */
        typeIdOf: (ctx: IContentPublishedContext): string | undefined => ctx.typeId
    }
] as const;

/** The declared-hook ids a hook trigger may bind to, for save-time validation. */
export const BINDABLE_HOOK_IDS: ReadonlySet<string> = new Set(BINDABLE_HOOKS.map(h => h.descriptor.id));

/**
 * Bindable-hook metadata served to the saved-prompt editor's hook picker
 * (`GET /query/prompts/hooks`), so the UI offers exactly the seams a save will
 * accept instead of hardcoding a copy of this allowlist.
 */
export const BINDABLE_HOOK_INFOS: ReadonlyArray<{ id: string; description: string }> =
    BINDABLE_HOOKS.map(h => ({ id: h.descriptor.id, description: h.descriptor.description }));

/**
 * One enqueued hook-trigger run: the prompt and trigger to fire plus the
 * flattened `{%hook.*%}` variables from the firing's payload. Durable job data
 * — everything the worker needs, since the hook context itself cannot outlive
 * the firing.
 */
export interface IHookPromptJob {
    /** Saved-prompt id to run (re-read fresh by the worker). */
    promptId: string;
    /** The hook trigger element that matched the firing. */
    triggerId: string;
    /** The declared hook id that fired, for logging and a stale-binding check. */
    hookId: string;
    /** Flattened per-run prompt variables from the hook payload. */
    variables: Record<string, string>;
}

/**
 * Minimum queue contract the module needs for hook-fired prompt runs. The
 * bootstrap supplies a factory backed by the BullMQ `QueueService` (queue +
 * worker on one name); tests omit the factory entirely, which disables the
 * hook-trigger path without touching Redis.
 */
export interface IHookPromptQueue {
    /** Enqueue one durable hook-prompt run. */
    enqueue(name: string, data: IHookPromptJob): Promise<unknown>;
}

/**
 * Builds the durable queue+worker pair for hook-fired prompt runs. Injected —
 * rather than the module constructing `QueueService` itself — because the
 * BullMQ constructor opens a Redis connection eagerly, which a unit-tested or
 * Redis-less boot must be able to avoid.
 */
export type HookPromptQueueFactory = (
    processor: (job: { data: IHookPromptJob }) => Promise<void>
) => IHookPromptQueue;

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
    /**
     * Factory for the durable hook-prompt queue+worker. Optional/nullable so
     * tests and a Redis-less boot still run the module; when absent the
     * `content.published` hook subscription is not registered and hook-bound
     * triggers simply never fire (they remain editable and inert).
     */
    hookQueueFactory?: HookPromptQueueFactory | null;
}

/**
 * Dedicated menu namespace for the /system/ai-tools in-page tab row. Kept out of
 * `main` so the tabs never leak into the global nav chrome — only the page's own
 * `MenuNavClient` reads this namespace (menu module's Submenu Pattern).
 */
const SUBMENU_NAMESPACE = 'ai-tools';

/**
 * The in-page tab row, declared as menu nodes rather than a hand-rolled button
 * array so the row inherits per-user gating, ordering, and live `menu:update`
 * refresh from the menu service. Each `url` carries a `?tab=` the client reads
 * to drive the active panel; the route is identical across tabs. The order
 * matches the historical shell (Query default, then Registry, Activity,
 * Approvals) so the deep links and default panel are unchanged.
 */
const SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Query', tab: 'query', icon: 'MessageSquare', order: 0 },
    { label: 'Registry', tab: 'registry', icon: 'Boxes', order: 1 },
    { label: 'Activity', tab: 'activity', icon: 'Activity', order: 2 },
    { label: 'Approvals', tab: 'approvals', icon: 'ShieldCheck', order: 3 }
];

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
    private hookQueueFactory: HookPromptQueueFactory | null = null;
    private hookPromptQueue: IHookPromptQueue | null = null;

    private registry!: AiToolRegistry;
    private policy!: ToolPolicyEngine;
    private audit!: ToolAuditStore;
    private approvals!: ToolApprovalQueue;
    private governor!: AiToolGovernor;
    private providerRegistry!: AiProviderRegistry;
    private screenConfig!: ScreenConfigService;
    private queryHistory!: AiQueryHistoryService;
    private savedPrompts!: SavedPromptsService;
    private socialPosts!: SocialPostStore;
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
        this.hookQueueFactory = dependencies.hookQueueFactory ?? null;

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

        // Drafts behind the provider-neutral `core:social-post` content type. The
        // built-in `propose-social-post` tool writes here and the curation type
        // resolves the opaque ref back to the draft. Constructed before the
        // curation watch below (whose onAvailable registers the type and reads
        // this store) and before registerBuiltinTools() (whose tool closes over
        // it), so neither can observe it undefined.
        this.socialPosts = new SocialPostStore(this.database, this.logger);
        await this.socialPosts.ensureIndexes();

        // The governor verifies a tool's `curationTypeId` binding against the
        // central curation service, which lives in its own module and publishes
        // 'curation' during its run(). Watch the registry so the resolver is
        // wired the moment curation appears and re-tightened (deny-all) if it
        // ever unregisters — order-independent and churn-safe. A declared binding
        // thus relaxes a tool's gates only while its owning type is registered.
        this.serviceRegistry.watch<ICurationService>(CURATION_SERVICE, {
            onAvailable: (curation) => {
                this.policy.setCurationResolver((typeId) => curation.hasType(typeId));
                // Register the provider-neutral `core:social-post` reviewable type
                // the moment curation appears (and again on every re-registration,
                // which registerType tolerates). This is what backs the
                // propose-social-post tool's verifiable curationTypeId binding and
                // makes the draft a curatable, destination-routable item. Fires
                // after every module init, so `socialPosts` is constructed by now.
                curation.registerType(createSocialPostCurationType(this.socialPosts, this.logger), this.metadata.id);
            },
            onUnavailable: () => this.policy.setCurationResolver(() => false)
        });

        this.governor = new AiToolGovernor(this.logger, this.registry, this.policy, this.audit, this.approvals, this.hookRegistry, {
            config: this.screenConfig,
            providers: this.providerRegistry,
            isEgressReachable: () => this.isEgressReachable()
        });

        this.queryHistory = new AiQueryHistoryService(this.logger, this.database);
        await this.queryHistory.ensureIndexes();

        // Hook triggers may only bind to the explicit bindable-hook allowlist,
        // so a saved prompt can never reference a seam that does not exist (or
        // one whose payload a prompt cannot consume).
        this.savedPrompts = new SavedPromptsService(this.database, { knownHookIds: BINDABLE_HOOK_IDS });
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

        this.controller = new AiToolsController(this.registry, this.policy, this.audit, this.approvals, this.governor, this.providerRegistry, this.queryHistory, this.savedPrompts, this.promptVariables, this.systemPrompts, this.resolveEndUser, this.screenConfig, (id: string) => this.runSavedPromptNow(id), BINDABLE_HOOK_INFOS);

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
            // Worked examples so the model reliably shapes the optional tone
            // enum and duration: a persistent warning (duration 0), a
            // default-duration success, and the title-only minimum.
            inputExamples: [
                { title: 'Scheduled maintenance at 02:00 UTC', description: 'The platform will be briefly unavailable for about 10 minutes while we deploy an update.', tone: 'warning', duration: 0 },
                { title: 'Blockchain sync restored', description: 'Indexing has caught up to the chain head.', tone: 'success' },
                { title: 'Read-only mode enabled' }
            ],
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

        // The provider-neutral social-posting tool. It drafts a destination-
        // agnostic post into the SocialPostStore and holds it in the central
        // curation queue; the curator picks which publish sinks (X, Telegram)
        // fan it out. Classified external / irreversible with
        // forcesCuratorReview bound to `core:social-post`, so the registry ships
        // it disabled and the governor treats unattended runs as safe (they can
        // only draft into the queue). The curation service is resolved lazily so
        // the tool tolerates curation registering after this module.
        const socialPostTool = createSocialPostTool({
            store: this.socialPosts,
            getCuration: () => this.serviceRegistry.get<ICurationService>(CURATION_SERVICE),
            logger: this.logger
        });
        this.registry.registerTool(socialPostTool, 'core');

        // The provider-neutral generic web-fetch tool. Fetches one public https
        // URL and returns its text under a full SSRF/redirect/size guard.
        // Classified external / reversible / public / surfaces-untrusted, so the
        // registry ships it disabled (opt-in), the governor bars it from
        // autonomous paths and wraps every result in the untrusted-content
        // envelope. It is domain-neutral infrastructure, hence a core built-in
        // here rather than a feature module. See web-fetch.ts for the guard
        // rationale and the lethal-trifecta implications of enabling it.
        this.registry.registerTool(createWebFetchTool(), 'core');
    }

    /**
     * Assemble the collaborator bundle every autonomous saved-prompt run shares,
     * so the firing paths — the hook-queue worker and the manual "run now"
     * endpoint — build identical dependencies from one place and can never drift.
     * `notify` is passed in because the admin run-notification callback is a
     * closure local to {@link run}; a manual run passes none.
     *
     * @param notify - Optional admin run-notification callback.
     * @returns The execution deps for {@link executeSavedPrompt}.
     */
    private buildSavedPromptExecutionDeps(notify?: ScheduledPromptNotifier): ISavedPromptExecutionDeps {
        return {
            savedPrompts: this.savedPrompts,
            logger: this.logger,
            resolveProvider: (providerId?: string) => providerId
                ? this.providerRegistry.getProvider(providerId)
                : this.providerRegistry.getActive(),
            resolveEndUser: this.resolveEndUser,
            composeSystemPrompt: (principal?: Parameters<SystemPromptsService['compose']>[0]) =>
                this.systemPrompts.compose(principal),
            notify,
            recordQuery: (record: Parameters<AiQueryHistoryService['append']>[0]) =>
                this.queryHistory.append(record)
        };
    }

    /**
     * Execute a saved prompt immediately on demand, exactly as an autonomous
     * firing would but initiated by an operator rather than a trigger. Runs
     * through the one shared {@link executeSavedPrompt} path — programmatic mode,
     * the prompt's re-resolved owner principal, its injected system prompt and
     * three-state tool allowlist, recorded to history — but with no trigger, so
     * it keeps no failure streak and can never auto-pause a schedule. Never
     * throws (the executor records every failure to history); callers fire it
     * and return without awaiting the possibly-minutes-long query. A manual run
     * does not fire the admin run-notification: the operator already has direct
     * feedback and the run was not scheduled.
     *
     * @param promptId - The saved prompt to run now.
     * @returns Resolves once the run and its history recording settle.
     */
    async runSavedPromptNow(promptId: string): Promise<void> {
        // Fired fire-and-forget from the controller (`void this.runSavedPromptNow(id)`),
        // so a rejection here has no awaiter and would surface as an unhandled promise
        // rejection. executeSavedPrompt never throws, but the savedPrompts lookup can
        // (transient DB error/failover); guard the whole body so this method honours
        // its documented "never throws" contract.
        try {
            const prompt = await this.savedPrompts.get(promptId);
            if (!prompt) {
                this.logger.warn({ promptId }, 'runSavedPromptNow: prompt not found');
                return;
            }
            await executeSavedPrompt(prompt, this.buildSavedPromptExecutionDeps(), {});
        } catch (err) {
            this.logger.error({ err, promptId }, 'runSavedPromptNow: failed to load or execute saved prompt');
        }
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

        this.serviceRegistry.register(AI_TOOLS_SERVICE, this.registry);
        this.serviceRegistry.register(AI_TOOL_GOVERNOR_SERVICE, this.governor);
        this.serviceRegistry.register(AI_PROVIDERS_SERVICE, this.providerRegistry);
        this.serviceRegistry.register(PROMPT_VARIABLES_SERVICE, this.promptVariables);

        // Declare the scheduled-prompt-run notification category on the
        // notifications service (published by the notifications module, which
        // runs before this one). Audience is the admin group, toast-only,
        // default-on, and user-silenceable — so every admin sees a toast when a
        // cron prompt runs, but any admin can opt out, and an admin can disable
        // the category for everyone from /system/notifications.
        const notifications = this.serviceRegistry.get<INotificationService>(NOTIFICATIONS_SERVICE);
        if (notifications) {
            // Register the content type the notification renders through, on the
            // same central registry curation publishes into. `describe(ref)`
            // echoes the title/body the notify() call carries by reference — the
            // notification path is content-registry-symmetric with curation.
            this.serviceRegistry.get<IContentRegistry>(CONTENT_TYPES_SERVICE)?.register(
                {
                    typeId: SCHEDULED_PROMPT_CONTENT_TYPE,
                    label: 'Scheduled AI prompt run',
                    describe: (ref) => ({
                        title: typeof ref.title === 'string' ? ref.title : undefined,
                        body: typeof ref.body === 'string' ? ref.body : undefined
                    })
                },
                this.metadata.id
            );
            notifications.registerCategory({
                id: SCHEDULED_PROMPT_NOTIFY_CATEGORY,
                label: 'Scheduled AI prompt runs',
                description: 'Fires when a cron-scheduled AI prompt finishes — success or failure.',
                source: this.metadata.id,
                defaultAudience: { groups: [ADMIN_GROUP_ID] },
                channelDefaults: { toast: true },
                userConfigurable: true,
                adminConfigurable: true,
                mutable: true
            });
        } else {
            this.logger.warn('notifications service unavailable; scheduled-prompt notifications disabled');
        }

        // Fans each scheduled-prompt run outcome to admins. Resolves the
        // notifications service per call (it never unregisters at runtime, but a
        // lazy lookup keeps this robust) and swallows dispatch errors so a
        // notification fault never disturbs the cron loop.
        const notifyScheduledRun: ScheduledPromptNotifier = (run) => {
            const svc = this.serviceRegistry.get<INotificationService>(NOTIFICATIONS_SERVICE);
            if (!svc) {
                return;
            }
            const ok = run.status === 'success';
            void svc
                .notify({
                    category: SCHEDULED_PROMPT_NOTIFY_CATEGORY,
                    typeId: SCHEDULED_PROMPT_CONTENT_TYPE,
                    ref: {
                        title: ok ? `Scheduled prompt ran: ${run.name}` : `Scheduled prompt failed: ${run.name}`,
                        body: ok
                            ? undefined
                            : run.disabled
                                ? `${run.error ?? 'Unknown error'} — auto-paused after repeated failures`
                                : run.error
                    },
                    severity: ok ? 'success' : 'error',
                    firedBy: run.promptId,
                    data: { promptId: run.promptId, disabled: run.disabled ?? false }
                })
                .catch((error) => this.logger.warn({ error, promptId: run.promptId }, 'Failed to dispatch scheduled-prompt notification'));
        };

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
                        (principal) => this.systemPrompts.compose(principal),
                        notifyScheduledRun,
                        (record) => this.queryHistory.append(record)
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

        // Hook-fired saved prompts. A `kind: 'hook'` trigger binds a prompt to a
        // declared observer seam (BINDABLE_HOOKS — today `content.published`);
        // the subscription below ENQUEUES the run on a durable queue and returns
        // immediately, never awaiting the AI call inline — the hook fires
        // in-process during another pipeline's commit (curation's decision
        // commit), and an inline multi-minute query there would block it. The
        // worker re-reads the prompt fresh, re-checks the binding, claims the
        // run, and executes through the same shared path as the cron runner.
        if (this.hookQueueFactory) {
            const execDeps = this.buildSavedPromptExecutionDeps(notifyScheduledRun);

            this.hookPromptQueue = this.hookQueueFactory(async (job) => {
                const { promptId, triggerId, hookId, variables } = job.data;
                // Re-read fresh: the prompt may have been edited or deleted
                // between enqueue and processing. A missing prompt or a removed/
                // disabled/re-typed trigger makes the job a silent no-op rather
                // than running stale configuration.
                const prompt = await this.savedPrompts.get(promptId);
                const trigger = prompt?.triggers?.find(t => t.id === triggerId);
                if (!prompt || !trigger || trigger.kind !== 'hook' || trigger.enabled === false || trigger.hookId !== hookId) {
                    this.logger.info({ promptId, triggerId, hookId }, 'Hook-prompt job dropped: prompt or trigger no longer bound');
                    return;
                }
                // Mirror the cron tick's no-provider guard exactly: when no AI
                // provider is registered at all (a provider swap or a
                // disabled-provider deployment), drop the job untouched rather
                // than claiming and executing. executeSavedPrompt would
                // otherwise record a provider-unavailable failure that counts
                // toward the trigger's 5-failure auto-pause, permanently pausing
                // a hook trigger the cron path would merely leave waiting. Gate
                // only on *zero* providers, never on an *active* one: a prompt
                // may pin a specific (inactive) provider, and that pinned-absent
                // case must still record a failure so the admin sees why it did
                // not fire.
                if (this.providerRegistry.listProviders().length === 0) {
                    this.logger.info({ promptId, triggerId, hookId }, 'Hook-prompt job dropped: no AI provider installed');
                    return;
                }
                // Claim mirrors the cron runner: stamp lastRunAt before the
                // query so the trigger row shows the attempt even if the
                // process dies mid-run. The queue's at-least-once delivery
                // means a crash can redeliver, which re-runs the prompt — an
                // accepted trade for a notification-style run.
                const claimedAt = new Date().toISOString();
                await this.savedPrompts.recordRunResult(promptId, triggerId, claimedAt, null);
                await executeSavedPrompt(prompt, execDeps, { triggerId, claimedAt, variables });
            });

            for (const bindable of BINDABLE_HOOKS) {
                this.hookRegistry.register('core', bindable.descriptor, async (ctx) => {
                    // Observer handler inside another pipeline's commit: do the
                    // minimum — find bound prompts, filter, enqueue — and let
                    // every failure surface only as a log line.
                    try {
                        const bound = await this.savedPrompts.listHookBound(bindable.descriptor.id);
                        const eventTypeId = bindable.typeIdOf(ctx);
                        for (const prompt of bound) {
                            const triggers = (prompt.triggers ?? []).filter(t =>
                                t.kind === 'hook'
                                && t.enabled !== false
                                && t.hookId === bindable.descriptor.id
                                && (!t.typeIdFilter || t.typeIdFilter === eventTypeId)
                            );
                            for (const trigger of triggers) {
                                await this.hookPromptQueue!.enqueue('hook-prompt-run', {
                                    promptId: prompt.id,
                                    triggerId: trigger.id,
                                    hookId: bindable.descriptor.id,
                                    variables: bindable.toVariables(ctx)
                                });
                            }
                        }
                    } catch (error) {
                        this.logger.error({ error, hook: bindable.descriptor.id }, 'Failed to enqueue hook-bound prompt runs');
                    }
                });
            }
            this.logger.info({ hooks: [...BINDABLE_HOOK_IDS] }, 'Hook-bound saved-prompt subscriptions registered');
        } else {
            this.logger.info('No hook-prompt queue factory injected — hook-bound saved-prompt triggers will not fire');
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

        // Register the in-page tab row as a namespaced menu (menu module's Submenu
        // Pattern). The nodes are memory-only and live outside the System
        // container, so the container's non-bypassable `requiresAdmin` force does
        // not reach them — the module sets `requiresAdmin` per node itself. The
        // page renders this namespace with MenuNavClient instead of hand-rolling
        // a `<button>` tab strip, inheriting per-user gating, ordering, and live
        // `menu:update` refresh.
        for (const tab of SUBMENU_TABS) {
            await this.menuService.create({
                namespace: SUBMENU_NAMESPACE,
                label: tab.label,
                url: `/system/ai-tools?tab=${tab.tab}`,
                icon: tab.icon,
                order: tab.order,
                parent: null,
                enabled: true,
                requiresAdmin: true
            });
        }
        this.logger.info('AI tools submenu tab nodes registered');

        this.logger.info(
            { services: [AI_TOOLS_SERVICE, AI_TOOL_GOVERNOR_SERVICE, AI_PROVIDERS_SERVICE, PROMPT_VARIABLES_SERVICE] },
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
