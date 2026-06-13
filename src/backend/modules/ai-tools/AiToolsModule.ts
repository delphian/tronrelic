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
    IDatabaseService,
    IHookRegistry,
    IMenuService,
    IModule,
    IModuleMetadata,
    IServiceRegistry
} from '@/types';
import { logger } from '../../lib/logger.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { AiToolRegistry } from './services/ai-tool-registry.js';
import { ToolPolicyEngine } from './services/tool-policy-engine.js';
import { ToolAuditStore } from './services/tool-audit-store.js';
import { ToolApprovalQueue } from './services/tool-approval-queue.js';
import { AiToolGovernor } from './services/ai-tool-governor.js';
import { AiProviderRegistry } from './services/ai-provider-registry.js';
import { AiToolsController } from './api/ai-tools.controller.js';
import { createAiToolsAdminRouter } from './api/ai-tools.router.js';

/** Service-registry name for the provider-neutral tool registry. */
export const AI_TOOLS_SERVICE = 'ai-tools';

/** Service-registry name for the tool execution governor. */
export const AI_TOOL_GOVERNOR_SERVICE = 'ai-tool-governor';

/** Service-registry name for the installed-AI-provider registry. */
export const AI_PROVIDERS_SERVICE = 'ai-providers';

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
    /** Menu service for registering the `/system/ai-tools` admin nav item. */
    menuService: IMenuService;
    /** Express app the admin router mounts onto. */
    app: Express;
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
    private app!: Express;

    private registry!: AiToolRegistry;
    private policy!: ToolPolicyEngine;
    private audit!: ToolAuditStore;
    private approvals!: ToolApprovalQueue;
    private governor!: AiToolGovernor;
    private providerRegistry!: AiProviderRegistry;
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
        this.app = dependencies.app;

        this.registry = new AiToolRegistry(this.logger, this.database);
        await this.registry.loadStates();

        this.policy = new ToolPolicyEngine(this.logger, this.database);
        await this.policy.loadOverrides();

        this.audit = new ToolAuditStore(this.logger, this.database);
        await this.audit.ensureIndexes();

        this.approvals = new ToolApprovalQueue(this.logger, this.database);
        await this.approvals.ensureIndexes();

        this.governor = new AiToolGovernor(this.logger, this.registry, this.policy, this.audit, this.approvals, this.hookRegistry);
        this.providerRegistry = new AiProviderRegistry(this.logger);
        this.controller = new AiToolsController(this.registry, this.policy, this.audit, this.approvals, this.governor, this.providerRegistry);

        this.logger.info('ai-tools module initialized');
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
            { services: [AI_TOOLS_SERVICE, AI_TOOL_GOVERNOR_SERVICE, AI_PROVIDERS_SERVICE] },
            'ai-tools module running (admin router mounted, services registered)'
        );
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
}
