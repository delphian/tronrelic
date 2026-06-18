/**
 * @file IPromptVariableRegistry.ts
 *
 * Core-owned registry that holds every prompt variable — code-registered
 * `dynamic` resolvers (registered by a provider plugin or core module) and
 * admin-authored `static` constants (persisted in `module_ai-tools_variables`) —
 * behind one service published as `'prompt-variables'`. An AI provider plugin
 * consumes it to expand `{%name%}` patterns at request-build time; the admin UI
 * consumes it to classify, create, edit, and delete variables; and the
 * lethal-trifecta detector consumes {@link getSecretVariableNames} so a
 * `secret`-classified variable counts as a private-data ingress.
 *
 * Promoting the registry to core (out of the trp-ai-assistant plugin) gives one
 * management surface, persists classification across restarts, and lets a future
 * provider plugin inherit variables instead of re-implementing them.
 */

import type { AiToolSensitivity } from './IAiToolCapability.js';
import type {
    IExpandedPromptVariable,
    IPromptVariableDefinition,
    IPromptVariableInfo,
    IStaticPromptVariable
} from './IPromptVariable.js';

/** Fields an admin supplies when creating a `static` variable. */
export interface IStaticPromptVariableInput {
    /** Kebab-case identifier; must not collide with a registered dynamic variable. */
    name: string;
    /** Human-readable description for the admin panel. */
    description: string;
    /** Grouping category for the admin panel. */
    category: string;
    /** The constant text spliced in wherever `{%name%}` appears. */
    content: string;
    /** Initial sensitivity; defaults to `secret` (fail-safe) when omitted. */
    sensitivity?: AiToolSensitivity;
}

/** Mutable fields of a `static` variable an admin may edit (the name is immutable). */
export interface IStaticPromptVariableUpdate {
    description?: string;
    category?: string;
    content?: string;
    sensitivity?: AiToolSensitivity;
}

/**
 * Registration, expansion, classification, and CRUD surface for prompt
 * variables. Published on the service registry as `'prompt-variables'`.
 */
export interface IPromptVariableRegistry {
    /**
     * Register a code-defined `dynamic` variable. Idempotent on name: a provider
     * re-registers every boot, so a repeat registration replaces the prior
     * definition rather than throwing.
     *
     * @param definition - The variable's metadata and resolver.
     * @param providerId - Manifest id of the registering plugin or module.
     */
    registerVariable(definition: IPromptVariableDefinition, providerId?: string): void;

    /**
     * Remove a registered dynamic variable by name.
     *
     * @param name - Variable name.
     * @returns `true` when a dynamic variable was found and removed.
     */
    unregisterVariable(name: string): boolean;

    /**
     * Resolve one variable to its current value. Fails loudly: an unknown name or
     * a resolver error throws rather than splicing an error string into a prompt.
     *
     * @param name - Variable name without the `{%%}` delimiters.
     * @returns The resolved content.
     */
    resolve(name: string): Promise<string>;

    /**
     * Expand every `{%name%}` pattern in the text.
     *
     * @param text - Prompt text possibly containing variable patterns.
     * @returns The text with all variables expanded.
     */
    expandAll(text: string): Promise<string>;

    /**
     * Expand every pattern and return per-variable metadata for the composer's
     * preview (what each resolved to and how large it is).
     *
     * @param text - Prompt text possibly containing variable patterns.
     * @returns The expanded text plus per-variable metadata.
     */
    expandWithMetadata(text: string): Promise<{ expanded: string; variables: IExpandedPromptVariable[] }>;

    /**
     * Serializable metadata for every variable (both kinds), for the admin panel.
     *
     * @returns Info for each variable, with effective sensitivity and size.
     */
    listInfo(): Promise<IPromptVariableInfo[]>;

    /**
     * Create an admin-authored `static` variable.
     *
     * @param input - The new variable's fields.
     * @returns The persisted variable.
     * @throws When the name is invalid, already exists, or collides with a
     *         registered dynamic variable (shadowing is rejected).
     */
    createStatic(input: IStaticPromptVariableInput): Promise<IStaticPromptVariable>;

    /**
     * Edit a `static` variable's mutable fields.
     *
     * @param name - The variable to edit.
     * @param patch - Fields to change.
     * @returns The updated variable.
     * @throws When no static variable with that name exists.
     */
    updateStatic(name: string, patch: IStaticPromptVariableUpdate): Promise<IStaticPromptVariable>;

    /**
     * Delete a `static` variable.
     *
     * @param name - The variable to delete.
     * @returns `true` when a static variable was found and removed.
     */
    deleteStatic(name: string): Promise<boolean>;

    /**
     * Set a variable's sensitivity classification. For a `static` variable this
     * writes the document field; for a `dynamic` variable it persists an admin
     * override that wins over the code-declared default.
     *
     * @param name - The variable to classify.
     * @param sensitivity - The new sensitivity.
     * @returns The variable's refreshed info.
     * @throws When no variable with that name exists.
     */
    classify(name: string, sensitivity: AiToolSensitivity): Promise<IPromptVariableInfo>;

    /**
     * Names of every variable whose effective sensitivity is `secret`. The
     * lethal-trifecta detector folds these in as a private-data leg, so a secret
     * variable beside an untrusted-content reader and an open egress reports
     * `lethal` rather than a false `safe`.
     *
     * @returns Secret-classified variable names (both kinds).
     */
    getSecretVariableNames(): string[];

    /**
     * Names of `secret` variables actually referenced by the given text — the
     * per-prompt check for the autonomous path, where a scheduled prompt that
     * splices a secret variable runs with no human reading the resolved content.
     *
     * @param text - Prompt text to scan for `{%name%}` references.
     * @returns Referenced secret variable names.
     */
    secretVariablesIn(text: string): string[];
}
