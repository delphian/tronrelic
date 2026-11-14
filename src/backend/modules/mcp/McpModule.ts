/**
 * @fileoverview The MCP module: TronRelic's Model Context Protocol endpoint.
 *
 * Lets members of the `mcp-users` group connect their own AI client (Claude,
 * Cursor, Claude Code) to `/mcp` and call the AI tools an admin approved for
 * one of their user groups, as themselves, and lets anyone call the tools
 * granted to the virtual `anonymous` group through `/mcp/public` without
 * signing in. Each group can carry its own protections (secret scrubbing, an
 * IP allowlist), its own call limits, and a switch that turns it off; outside
 * `mcp-users` and `anonymous` it can be cleared for restricted tools. The
 * identity module is the OAuth authorization server; this module is the
 * protected resource. Every tool call runs through the AI tool governor under
 * the `mcp` trigger path, so MCP gets the same validation, policy, rate
 * limits, and audit as every other path, and every call is counted in the
 * ClickHouse `mcp_calls` table for the usage view.
 *
 * Follows the two-phase lifecycle: `init()` builds the services and indexes,
 * `run()` creates the MCP group if needed, registers the admin page's menu
 * entries, starts the accounting meter, and mounts both endpoints, the
 * discovery document, and the admin API.
 */

import type { Express } from 'express';
import type {
    HookRegisterDisposer,
    IAccountDirectoryService,
    IAiToolGovernor,
    IAiToolRegistry,
    IClickHouseService,
    IConnectedAppsService,
    IDatabaseService,
    IHookRegistry,
    IMcpAccessTokenVerifier,
    IMenuService,
    IModule,
    IModuleMetadata,
    IUserGroupService
} from '@/types';
import { MCP_ANONYMOUS_GROUP_ID, MCP_USERS_GROUP_ID } from '@/types';
import { logger } from '../../lib/logger.js';
import { HOOKS } from '../../hooks/registry.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { McpSettingsStore } from './services/mcp-settings.store.js';
import { McpToolExposureService } from './services/mcp-tool-exposure.service.js';
import { McpGroupPolicyService } from './services/McpGroupPolicyService.js';
import { SecretScrubber } from './services/SecretScrubber.js';
import type { EndUserResolver } from '../ai-tools/index.js';
import { McpCallerResolver } from './services/mcp-caller.resolver.js';
import { McpServerFactory } from './services/mcp-server.factory.js';
import { OAuthCallerAuthenticator } from './services/OAuthCallerAuthenticator.js';
import { AnonymousCallerAuthenticator } from './services/AnonymousCallerAuthenticator.js';
import { AnonymousCallerKeyer } from './services/AnonymousCallerKeyer.js';
import { McpCallMeter } from './services/McpCallMeter.js';
import { McpUsageService } from './services/McpUsageService.js';
import { McpEndpointController } from './api/mcp-endpoint.controller.js';
import { McpAdminController } from './api/mcp-admin.controller.js';
import { createMcpAdminRouter } from './api/mcp-admin.routes.js';
import { createProtectedResourceMetadataHandler } from './api/protected-resource-metadata.js';
import { createAiCatalogHandler, createServerCardHandler } from './api/server-card.js';
import { buildMcpServerIdentity } from './services/buildMcpServerIdentity.js';
import type { IMcpServerIdentity } from './services/IMcpServerIdentity.js';

/**
 * The endpoint's public URLs, computed by the identity module from the same
 * base URL its token issuer uses.
 */
export interface IMcpEndpointConfig {
    /** The MCP endpoint URL and the audience every token must carry. */
    resourceUrl: string;

    /** Where the protected resource metadata is served. */
    resourceMetadataUrl: string;

    /** The public endpoint URL, which takes no sign-in. */
    publicUrl: string;

    /** Where the public endpoint's Server Card is served. */
    serverCardUrl: string;

    /** Where the site's AI Catalog, which lists the Server Card, is served. */
    aiCatalogUrl: string;

    /** The OAuth issuer. */
    issuer: string;

    /** The site's host name, the only value a browser `Origin` header may carry. */
    siteHost: string;
}

/**
 * Dependencies the MCP module needs, all injected by the bootstrap.
 */
export interface IMcpModuleDependencies {
    /** Core database, for the module's settings and approvals collections. */
    database: IDatabaseService;

    /** Express app the module mounts its routes on. */
    app: Express;

    /** Menu service, for the admin nav item and the admin page's tab row. */
    menuService: IMenuService;

    /** The AI tool governor every MCP tool call runs through. */
    governor: IAiToolGovernor;

    /** The AI tool registry, the source of truth for which tools exist. */
    toolRegistry: IAiToolRegistry;

    /** The identity module's token verifier. */
    tokenVerifier: IMcpAccessTokenVerifier;

    /**
     * The identity module's grant store, for the admin page's connected apps
     * and for recording when each app last called the endpoint.
     */
    connectedApps: IConnectedAppsService;

    /**
     * Group service, used to create the MCP group, count its members, list
     * the groups tools can be granted to, and read each caller's groups.
     */
    userGroups: IUserGroupService;

    /**
     * Declared-hook registry. The module listens on `http.groupDeleted` to
     * remove a deleted group's grants and settings, because group ids can be
     * reused and a new group would otherwise inherit them.
     */
    hookRegistry: IHookRegistry;

    /**
     * The deployment's own secret values (admin token, auth secrets, API keys,
     * database URLs). Results of tools served through a group that asks for
     * scrubbing have every occurrence of these replaced before they leave.
     */
    knownSecrets: string[];

    /** Resolves a user id to the live principal the governor scopes calls to. */
    resolveEndUser: EndUserResolver;

    /** Account directory, to label signed-in callers by email in the usage view. */
    accountDirectory: Pick<IAccountDirectoryService, 'getAccountsByIds'>;

    /**
     * ClickHouse, where every call is counted for the usage view. Optional:
     * without it nothing is counted and the usage view says so, while both
     * endpoints and every limit work as normal.
     */
    clickhouse?: IClickHouseService;

    /**
     * Server-side secret mixed into the hash anonymous callers are counted
     * under, so the stored id cannot be turned back into a network address.
     */
    anonymousKeySalt: string;

    /** The endpoints' public URLs. */
    endpoint: IMcpEndpointConfig;
}

/** Menu namespace holding the admin page's tab row. */
const SUBMENU_NAMESPACE = 'mcp';

/**
 * Longest the shutdown handler waits for the last accounting write. A
 * healthy write of one small batch takes milliseconds; this leaves most of
 * the container's stop grace period for the blockchain drain that follows.
 */
const SHUTDOWN_DRAIN_MS = 5_000;

/**
 * The admin page's tabs. The module owns collections and a ClickHouse table
 * and writes logs, so it carries Database and Logs tabs; it registers no
 * scheduler jobs, so it has no Schedules tab. The Overview tab carries the
 * usage view.
 */
const SUBMENU_TABS: ReadonlyArray<{ label: string; tab: string; icon: string; order: number }> = [
    { label: 'Overview', tab: 'overview', icon: 'Power', order: 0 },
    { label: 'Tools', tab: 'tools', icon: 'Wrench', order: 1 },
    { label: 'Connected apps', tab: 'apps', icon: 'PlugZap', order: 2 },
    { label: 'Activity', tab: 'activity', icon: 'Activity', order: 3 },
    { label: 'Database', tab: 'database', icon: 'Database', order: 4 },
    { label: 'Logs', tab: 'logs', icon: 'ScrollText', order: 5 }
];

/**
 * The MCP endpoint module.
 */
export class McpModule implements IModule<IMcpModuleDependencies> {
    /** Module metadata for introspection and logging. */
    readonly metadata: IModuleMetadata = {
        id: 'mcp',
        name: 'MCP',
        version: '1.3.0',
        description: 'Model Context Protocol endpoints serving AI tools an admin approved per user group: to members of mcp-users at /mcp, and to anonymous callers at /mcp/public'
    };

    private app!: Express;
    private menuService!: IMenuService;
    private userGroups!: IUserGroupService;
    private hookRegistry!: IHookRegistry;
    private exposure!: McpToolExposureService;
    private policies!: McpGroupPolicyService;
    private endpoint!: IMcpEndpointConfig;
    private identity!: IMcpServerIdentity;

    /**
     * Disposer for the `http.groupDeleted` handler. A core module lives for
     * the process lifetime, so this is never called; it is kept for symmetry
     * with the plugin pattern and to make the registration easy to find.
     */
    private groupDeletedDisposer: HookRegisterDisposer | null = null;

    /** Disposer for the `ai.toolInvoked` handler that feeds the accounting meter; kept for the same reason. */
    private toolInvokedDisposer: HookRegisterDisposer | null = null;
    private endpointController!: McpEndpointController;
    private publicEndpointController!: McpEndpointController;
    private adminController!: McpAdminController;
    private meter!: McpCallMeter;
    private initialized = false;

    private readonly logger = logger.child({ module: 'mcp' });

    /**
     * Build the module's services and create its indexes. Mounts nothing.
     *
     * @param deps - The injected dependencies.
     * @returns Resolves when the services exist and indexes are in place.
     */
    async init(deps: IMcpModuleDependencies): Promise<void> {
        this.logger.info('Initializing MCP module...');

        this.app = deps.app;
        this.menuService = deps.menuService;
        this.userGroups = deps.userGroups;
        this.hookRegistry = deps.hookRegistry;
        this.endpoint = deps.endpoint;

        const settings = new McpSettingsStore(deps.database, this.logger);
        const policies = new McpGroupPolicyService(deps.database, deps.userGroups, this.logger);
        await policies.createIndexes();
        const exposure = new McpToolExposureService(deps.database, deps.toolRegistry, policies, this.logger);
        await exposure.createIndexes();
        this.policies = policies;
        this.exposure = exposure;
        this.meter = new McpCallMeter(deps.clickhouse, this.logger);
        const callers = new McpCallerResolver(deps.tokenVerifier, deps.resolveEndUser, deps.connectedApps, this.logger);
        // One identity feeds the handshake and the Server Card, so what a
        // client sees after connecting matches what it read before.
        this.identity = buildMcpServerIdentity(new URL(deps.endpoint.publicUrl).origin);
        const serverFactory = new McpServerFactory(deps.governor, new SecretScrubber(deps.knownSecrets), this.logger, this.identity);
        const allowedOriginHosts = [deps.endpoint.siteHost];

        this.endpointController = new McpEndpointController(
            settings,
            exposure,
            new OAuthCallerAuthenticator(callers, this.logger),
            serverFactory,
            { resourceUrl: deps.endpoint.resourceUrl, resourceMetadataUrl: deps.endpoint.resourceMetadataUrl, allowedOriginHosts },
            this.meter,
            this.logger
        );
        // The public endpoint runs the same pipeline with a different
        // authenticator. API keys, when built, will be a second authenticator
        // tried before the anonymous one here.
        this.publicEndpointController = new McpEndpointController(
            settings,
            exposure,
            new AnonymousCallerAuthenticator(new AnonymousCallerKeyer(deps.anonymousKeySalt), deps.endpoint.resourceUrl),
            serverFactory,
            { resourceUrl: deps.endpoint.publicUrl, allowedOriginHosts },
            this.meter,
            this.logger
        );
        this.adminController = new McpAdminController(
            settings,
            exposure,
            policies,
            deps.connectedApps,
            deps.userGroups,
            new McpUsageService(deps.clickhouse, policies, deps.accountDirectory, this.logger),
            { resourceUrl: deps.endpoint.resourceUrl, publicUrl: deps.endpoint.publicUrl, issuer: deps.endpoint.issuer },
            this.logger
        );

        this.initialized = true;
        this.logger.info('MCP module initialized');
    }

    /**
     * Create the MCP group, register the admin page, and mount the routes.
     *
     * @returns Resolves when the module is live.
     * @throws {Error} When called before `init()`.
     */
    async run(): Promise<void> {
        if (!this.initialized) {
            throw new Error('McpModule.run() called before init()');
        }
        this.logger.info('Running MCP module...');

        await this.ensureGroup();
        await this.warnOnReservedGroup();
        await this.registerMenu();

        // Every call the governor handles on the `mcp` path is counted from
        // its audit record, so the accounting rows and the audit trail can
        // never disagree about what happened. The meter ignores other paths.
        this.toolInvokedDisposer = this.hookRegistry.register(
            'core',
            HOOKS.ai.toolInvoked,
            async (record) => { this.meter.observe(record); },
            { priority: 100 }
        );
        this.meter.start();

        // A deleted group's id can be reused, so its grants and settings are
        // removed here rather than left for a later group of the same name to
        // inherit. Observer isolation keeps a failure here from failing the
        // deletion; the failure is logged by the hook registry.
        this.groupDeletedDisposer = this.hookRegistry.register(
            'core',
            HOOKS.http.groupDeleted,
            async ({ groupId }) => {
                await this.exposure.withdrawGroupGrants(groupId);
                await this.policies.deleteForGroup(groupId);
            },
            { priority: 100 }
        );

        // The mount paths are read from the URLs the identity module derived,
        // so the route that serves requests and the audience tokens are bound
        // to cannot drift apart if the endpoint path ever changes.
        // The endpoint answers every method so non-POST requests get a 405
        // with an Allow header rather than Express's 404.
        this.app.all(new URL(this.endpoint.resourceUrl).pathname, this.endpointController.handle);
        this.app.all(new URL(this.endpoint.publicUrl).pathname, this.publicEndpointController.handle);

        // Protected resource metadata, at the RFC 9728 path for the resource
        // and at the bare path for clients that look there.
        const metadata = createProtectedResourceMetadataHandler(this.endpoint.resourceUrl, this.endpoint.issuer);
        this.app.get(new URL(this.endpoint.resourceMetadataUrl).pathname, metadata);
        this.app.get('/.well-known/oauth-protected-resource', metadata);

        // Pre-connection discovery: the public endpoint's Server Card and the
        // AI Catalog listing it. Mounted with `all` so a wrong method gets a
        // 405 and the browser preflight an answer, both from the handler.
        this.app.all(new URL(this.endpoint.serverCardUrl).pathname, createServerCardHandler(this.identity, this.endpoint.publicUrl));
        this.app.all(new URL(this.endpoint.aiCatalogUrl).pathname, createAiCatalogHandler(this.identity, this.endpoint.serverCardUrl));

        this.app.use('/api/admin/mcp', createMcpAdminRouter(this.adminController));

        this.logger.info(
            { resourceUrl: this.endpoint.resourceUrl, publicUrl: this.endpoint.publicUrl, serverCardUrl: this.endpoint.serverCardUrl },
            'MCP endpoints, discovery documents, and admin API mounted'
        );
    }

    /**
     * Write the accounting rows still buffered, so a restart does not lose the
     * usage totals for the calls served just before it.
     *
     * The meter writes to ClickHouse on a five-second interval, so a process
     * that exits without this drops every row buffered since the last write,
     * which would turn every deployment into a silent undercount on the usage
     * view. The graceful shutdown handler in `index.ts` awaits this before
     * exiting. The wait is capped at {@link SHUTDOWN_DRAIN_MS}, because the
     * ClickHouse client allows a request 30 seconds and the container's stop
     * grace period is 30 seconds in total; a hung write gives up its rows
     * rather than the process being killed mid-shutdown. Calling it before
     * `init()`, or twice, is safe.
     *
     * @returns Resolves once the last accounting write has finished, failed,
     *   or run past the cap.
     */
    async stop(): Promise<void> {
        if (this.initialized) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const capped = new Promise<'timeout'>(resolve => {
                timer = setTimeout(() => resolve('timeout'), SHUTDOWN_DRAIN_MS);
            });
            const outcome = await Promise.race([this.meter.stop().then(() => 'drained' as const), capped]);
            clearTimeout(timer);
            if (outcome === 'timeout') {
                this.logger.warn({ waitedMs: SHUTDOWN_DRAIN_MS }, 'MCP accounting rows were not written before shutdown; they are lost');
            }
        }
    }

    /**
     * Warn when a real user group already holds the id reserved for anonymous
     * callers.
     *
     * The identity module now refuses to create one, but a group created
     * before the reservation would still exist. Its members are never given
     * the anonymous grants (the caller resolver drops the id from their
     * groups), and the admin page lists only the virtual group under it, so
     * the real group has no MCP effect. It should still be renamed, because
     * its grants and settings are stored under the same id as the virtual
     * group's.
     *
     * @returns Resolves once the check has run.
     */
    private async warnOnReservedGroup(): Promise<void> {
        if (await this.userGroups.getGroup(MCP_ANONYMOUS_GROUP_ID)) {
            this.logger.warn(
                { groupId: MCP_ANONYMOUS_GROUP_ID },
                'A user group uses the id reserved for anonymous MCP callers; it has no MCP effect and should be deleted or recreated under another id'
            );
        }
    }

    /**
     * Create the `mcp-users` group when it does not exist yet, so an admin can
     * add members from `/system/users` without creating it by hand.
     *
     * Two backend instances starting together can both see the group missing,
     * and the second `createGroup` then throws a conflict. A failed create is
     * therefore accepted when the group exists afterwards, so that race does
     * not abort startup; any other failure still propagates.
     *
     * @returns Resolves when the group exists.
     * @throws When the group could not be created and still does not exist.
     */
    private async ensureGroup(): Promise<void> {
        const existing = await this.userGroups.getGroup(MCP_USERS_GROUP_ID);
        if (!existing) {
            try {
                await this.userGroups.createGroup({
                    id: MCP_USERS_GROUP_ID,
                    name: 'MCP users',
                    description: 'Members may connect their own AI client to TronRelic over MCP and call the tools an admin has approved on /system/mcp.'
                });
                this.logger.info({ groupId: MCP_USERS_GROUP_ID }, 'MCP user group created');
            } catch (error: unknown) {
                const createdElsewhere = await this.userGroups.getGroup(MCP_USERS_GROUP_ID);
                if (!createdElsewhere) {
                    throw error;
                }
            }
        }
    }

    /**
     * Register the admin nav item and the admin page's tab row.
     *
     * The nav item sits under the System container, whose parent chain forces
     * `requiresAdmin`. The tab nodes live in their own namespace outside that
     * container, so each sets `requiresAdmin` itself.
     *
     * @returns Resolves when every node is registered.
     */
    private async registerMenu(): Promise<void> {
        await this.menuService.create({
            namespace: 'main',
            label: 'MCP',
            url: '/system/mcp',
            icon: 'Cable',
            order: 46,
            parent: MAIN_SYSTEM_CONTAINER_ID,
            enabled: true
        });
        for (const tab of SUBMENU_TABS) {
            await this.menuService.create({
                namespace: SUBMENU_NAMESPACE,
                label: tab.label,
                url: `/system/mcp?tab=${tab.tab}`,
                icon: tab.icon,
                order: tab.order,
                parent: null,
                enabled: true,
                requiresAdmin: true
            });
        }
    }
}
