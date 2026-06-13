/**
 * @file IAiToolRegistry.ts
 *
 * Core-owned registry that tool providers (core modules and plugins) register
 * with, and that AI provider plugins read governed tool declarations from.
 * Provider-neutral and published on the service registry, so tools do not
 * couple to any one AI provider.
 */

import type { IAiTool, IAiToolInputSchema } from './IAiTool.js';
import type { IAiToolCapability } from './IAiToolCapability.js';

/** A tool advertised to a model: the contract minus the server-side handler. */
export interface IAiToolDeclaration {
    /** Unique tool name. */
    name: string;

    /** Description sent to the model; the dominant factor in tool selection. */
    description: string;

    /** JSON Schema for the tool's input parameters. */
    inputSchema: IAiToolInputSchema;

    /** Governance classification, when the tool declares one. */
    capability?: IAiToolCapability;
}

/** Serializable tool metadata for the admin registry view. */
export interface IAiToolInfo extends IAiToolDeclaration {
    /** Whether the tool is currently enabled for use in queries. */
    enabled: boolean;

    /** Plugin or module id that registered the tool, or `unknown` for legacy callers. */
    provider: string;
}

/**
 * Registration and lookup surface for AI tools. Tool providers register on
 * `init()` and unregister on `disable()`; AI provider plugins read enabled
 * declarations to build their request, then execute through the governor.
 */
export interface IAiToolRegistry {
    /**
     * Register a tool. Throws if the name is invalid or already registered by
     * a different provider.
     *
     * @param tool - Tool definition including its capability classification.
     * @param providerId - Manifest id of the owning plugin or module.
     */
    registerTool(tool: IAiTool, providerId?: string): void;

    /**
     * Remove a registered tool by name.
     *
     * @param name - Tool name to unregister.
     * @returns `true` if the tool was found and removed.
     */
    unregisterTool(name: string): boolean;

    /** All registered tools, regardless of enabled state. */
    listTools(): IAiTool[];

    /** Only the tools currently enabled for use in queries. */
    getEnabledTools(): IAiTool[];

    /** Handler-free declarations for the enabled tools, for a provider to format for its API. */
    getEnabledToolDeclarations(): IAiToolDeclaration[];

    /**
     * Look up a single registered tool by name.
     *
     * @param name - Tool name.
     * @returns The tool, or `undefined` when not registered.
     */
    getTool(name: string): IAiTool | undefined;

    /** Serializable metadata for every tool, for the admin registry view. */
    listToolInfo(): IAiToolInfo[];

    /**
     * Set a tool's enabled state and persist it.
     *
     * @param name - Tool name.
     * @param enabled - Target enabled state.
     * @returns `true` when the tool exists and was updated.
     */
    setEnabled(name: string, enabled: boolean): Promise<boolean>;
}
