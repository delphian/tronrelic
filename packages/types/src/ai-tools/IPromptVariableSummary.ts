/**
 * @file IPromptVariableSummary.ts
 *
 * The describing fields of one prompt variable, without its value or its size.
 * Produced without running any resolver, so a caller that only needs to know
 * which variables exist — the `ai-list-prompt-variables` AI tool, or a check on
 * a variable's effective sensitivity before resolving it — does not pay for
 * every dynamic resolver to run, and never receives a static variable's stored
 * text by accident.
 */

import type { AiToolSensitivity } from './IAiToolCapability.js';
import type { PromptVariableKind } from './IPromptVariable.js';

/**
 * Metadata for one prompt variable of either kind. {@link IPromptVariableInfo}
 * extends it with the size and admin-only fields the Registry tab needs.
 */
export interface IPromptVariableSummary {
    /** Kebab-case identifier without the `{%%}` delimiters. */
    name: string;

    /** The `{%name%}` reference pattern, precomputed so callers do not rebuild it. */
    pattern: string;

    /** Human-readable description of what the variable holds. */
    description: string;

    /** Grouping category, such as "Blockchain & Network". */
    category: string;

    /** Whether the variable is a code resolver (`dynamic`) or an admin constant (`static`). */
    kind: PromptVariableKind;

    /** Effective sensitivity after applying any admin override. */
    sensitivity: AiToolSensitivity;
}
