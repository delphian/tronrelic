/**
 * @file IPromptVariable.ts
 *
 * Prompt variables — named tokens (referenced in a prompt as `{%name%}`) that
 * expand to live system data or admin-authored text before a query is sent to
 * the model. Promoted out of the trp-ai-assistant plugin into core so a single
 * registry owns every variable, classification persists, and the lethal-trifecta
 * detector can see when a *secret* variable is in play — the private-data ingress
 * the tool-scoped trifecta signal historically could not model.
 *
 * Two kinds share one registry:
 *  - `dynamic` — a code-registered resolver (closes over live services); a
 *    provider plugin or core module registers it at init. Admins can classify it
 *    but cannot edit or delete it (there is no code to author from the UI).
 *  - `static` — an admin-authored constant string, persisted to the core
 *    `module_ai-tools_variables` collection; full create/edit/delete from the
 *    admin UI.
 *
 * The sensitivity vocabulary is shared with {@link AiToolSensitivity} so a
 * variable and a tool that surface the same class of data are classified
 * identically.
 */

import type { AiToolSensitivity } from './IAiToolCapability.js';

/** Whether a variable is a code-registered resolver or an admin-authored constant. */
export type PromptVariableKind = 'dynamic' | 'static';

/**
 * In-process registration contract for a `dynamic` (code-registered) variable.
 * Carries a resolver, so it is not serializable — it is the registration shape a
 * provider plugin or core module hands the registry, mirroring how `IAiTool`
 * carries a handler.
 */
export interface IPromptVariableDefinition {
    /** Kebab-case identifier used in `{%name%}` patterns. Unique across the registry. */
    name: string;

    /** Human-readable description shown in the admin variable panel. */
    description: string;

    /** Grouping category for the admin panel (e.g. "Blockchain & Network"). */
    category: string;

    /**
     * Code-declared default sensitivity. Optional: when omitted the registry
     * treats a dynamic variable as `internal` until an admin classifies it. An
     * admin classification override always wins over this default.
     */
    sensitivity?: AiToolSensitivity;

    /** Resolver that fetches and formats the variable's current value. */
    resolve: () => Promise<string>;
}

/**
 * Persisted shape of a `static` (admin-authored) variable, stored one document
 * per variable in `module_ai-tools_variables`.
 */
export interface IStaticPromptVariable {
    /** Kebab-case identifier used in `{%name%}` patterns. Unique across the registry. */
    name: string;

    /** Human-readable description shown in the admin variable panel. */
    description: string;

    /** Grouping category for the admin panel. */
    category: string;

    /**
     * Effective sensitivity. A new static variable defaults to `secret`
     * (fail-safe — its pasted content is unknown and could hold a key or seed)
     * until an admin classifies it down.
     */
    sensitivity: AiToolSensitivity;

    /** The constant text spliced in wherever `{%name%}` appears. */
    content: string;

    /** ISO timestamp of creation. */
    createdAt: string;

    /** ISO timestamp of the last edit. */
    updatedAt: string;
}

/**
 * Serializable metadata for one variable in the admin panel — unifies both kinds
 * behind a single view. The resolver/content is not included; size is measured
 * by resolving once.
 */
export interface IPromptVariableInfo {
    /** Kebab-case identifier. */
    name: string;

    /** The `{%name%}` reference pattern, precomputed for the UI. */
    pattern: string;

    /** Human-readable description. */
    description: string;

    /** Grouping category. */
    category: string;

    /** Whether the variable is a code resolver (`dynamic`) or admin constant (`static`). */
    kind: PromptVariableKind;

    /** Effective sensitivity after applying any admin override. */
    sensitivity: AiToolSensitivity;

    /**
     * Whether the effective sensitivity comes from an admin `override`, the
     * variable's `declared` default, or the registry `default`. Lets the UI show
     * an operator that a classification is an explicit choice vs. a fallback.
     */
    sensitivitySource: 'override' | 'declared' | 'default';

    /** Whether an admin may edit/delete this variable (true for `static` only). */
    editable: boolean;

    /** UTF-8 byte size of the resolved value (0 when the resolver currently fails). */
    sizeBytes: number;
}

/**
 * One expanded variable's metadata, returned alongside the expanded text so the
 * query composer can show what each `{%name%}` resolved to and how large it is
 * before the prompt is sent.
 */
export interface IExpandedPromptVariable {
    /** Variable name without the `{%%}` delimiters. */
    name: string;

    /** The `{%name%}` reference pattern that was replaced. */
    pattern: string;

    /** UTF-8 byte size of the resolved content. */
    sizeBytes: number;
}
