/**
 * @file ai-tool-registry.ts
 *
 * Core-owned registry of AI tools. Tool providers — core modules and plugins —
 * register here; an AI provider plugin reads the enabled declarations to build
 * its request and executes each call through the governor. Promoted out of the
 * trp-ai-assistant plugin so tool governance is provider-neutral and owned by
 * core, not by whichever AI provider plugin happens to be installed.
 *
 * Enabled/disabled state persists to the core key-value store so admin toggles
 * survive restarts. Provider attribution is re-captured on each registration
 * (providers re-register every boot through the service-registry watch).
 */

import type {
    IAiTool,
    IAiToolDeclaration,
    IAiToolInfo,
    IAiToolRegistry,
    IDatabaseService,
    ISystemLogService
} from '@/types';
import { AI_TOOL_NAME_PATTERN } from '@/types';
import { lintToolCapability } from './capability-linter.js';

/** Core `_kv` key (manually namespaced) for persisted per-tool enabled state. */
const TOOL_STATES_KEY = 'ai-tools:tool-states';

/** Sentinel provider id when a caller registers a tool without attribution. */
const UNKNOWN_PROVIDER = 'unknown';

/** Persisted shape under {@link TOOL_STATES_KEY}: tool name → enabled flag. */
type ToolStates = Record<string, boolean>;

/**
 * Decide a newly-registered tool's default enabled state from its capability.
 *
 * Least privilege: external, irreversible, and money-spending tools ship
 * disabled so an operator must opt them in; everything else ships enabled. A
 * persisted admin toggle always overrides this default on later boots.
 *
 * @param tool - The tool being registered for the first time.
 * @returns Whether the tool should default to enabled.
 */
function defaultEnabledFor(tool: IAiTool): boolean {
    const cap = tool.capability;
    const dangerous = !!cap && (cap.sideEffect === 'external' || cap.reversible === false || cap.spendsMoney === true);
    return !dangerous;
}

/**
 * Map of tools available to an AI provider during queries, with per-tool
 * enabled state and source attribution. Used by the governor for lookup and by
 * the admin registry view for introspection.
 */
export class AiToolRegistry implements IAiToolRegistry {
    /** Registered tools keyed by name. */
    private readonly tools = new Map<string, IAiTool>();

    /**
     * Tool name → owning provider id. Kept separate from {@link tools} so the
     * cross-plugin `IAiTool` contract stays handler-and-metadata only —
     * attribution is a registry concern, not a tool-shape concern.
     */
    private readonly providers = new Map<string, string>();

    /** In-memory mirror of the persisted enabled state. */
    private toolStates: ToolStates = {};

    /**
     * @param logger - Module-scoped logger for registration diagnostics.
     * @param database - Core database for persisting enabled state.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Load persisted enabled state from the key-value store. Call once during
     * module init, before any provider registers a tool.
     *
     * @returns Resolves when the persisted state has been hydrated.
     */
    async loadStates(): Promise<void> {
        this.toolStates = (await this.database.get<ToolStates>(TOOL_STATES_KEY)) ?? {};
    }

    /** @inheritdoc */
    registerTool(tool: IAiTool, providerId: string = UNKNOWN_PROVIDER): void {
        if (!AI_TOOL_NAME_PATTERN.test(tool.name)) {
            throw new Error(
                `Invalid tool name "${tool.name}". Must match ^[a-zA-Z0-9_-]{1,64}$ ` +
                '(alphanumeric, hyphens, underscores, max 64 chars).'
            );
        }
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered`);
        }

        const provider = providerId || UNKNOWN_PROVIDER;

        // Lint the capability declaration once, at registration. An `error`
        // finding (a self-contradictory declaration) blocks registration so the
        // mistake fails loudly at boot; `warn` findings — likely
        // misclassifications, including an undeclared untrusted-content source —
        // are logged and the tool still registers.
        const findings = lintToolCapability(tool);
        const blocking = findings.find(finding => finding.severity === 'error');
        if (blocking) {
            throw new Error(blocking.message);
        }
        for (const finding of findings) {
            this.logger.warn({ tool: tool.name, provider }, finding.message);
        }

        this.tools.set(tool.name, tool);
        this.providers.set(tool.name, provider);
        if (this.toolStates[tool.name] === undefined) {
            this.toolStates[tool.name] = defaultEnabledFor(tool);
        }

        this.logger.info(
            { tool: tool.name, provider, enabled: this.toolStates[tool.name] },
            `AI tool registered: ${tool.name}`
        );
    }

    /** @inheritdoc */
    unregisterTool(name: string): boolean {
        const removed = this.tools.delete(name);
        this.providers.delete(name);
        if (removed) {
            this.logger.info({ tool: name }, `AI tool unregistered: ${name}`);
        }
        return removed;
    }

    /** @inheritdoc */
    listTools(): IAiTool[] {
        return Array.from(this.tools.values());
    }

    /** @inheritdoc */
    getEnabledTools(): IAiTool[] {
        return Array.from(this.tools.values()).filter(tool => this.toolStates[tool.name] !== false);
    }

    /** @inheritdoc */
    getEnabledToolDeclarations(): IAiToolDeclaration[] {
        return this.getEnabledTools().map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            capability: tool.capability
        }));
    }

    /** @inheritdoc */
    getTool(name: string): IAiTool | undefined {
        return this.tools.get(name);
    }

    /** @inheritdoc */
    listToolInfo(): IAiToolInfo[] {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            capability: tool.capability,
            enabled: this.toolStates[tool.name] !== false,
            provider: this.providers.get(tool.name) ?? UNKNOWN_PROVIDER
        }));
    }

    /** @inheritdoc */
    async setEnabled(name: string, enabled: boolean): Promise<boolean> {
        let updated = false;
        if (this.tools.has(name)) {
            this.toolStates[name] = enabled;
            await this.database.set(TOOL_STATES_KEY, this.toolStates);
            this.logger.info({ tool: name, enabled }, `AI tool ${enabled ? 'enabled' : 'disabled'}: ${name}`);
            updated = true;
        }
        return updated;
    }
}
