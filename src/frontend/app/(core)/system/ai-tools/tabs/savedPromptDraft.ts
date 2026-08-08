/**
 * @file savedPromptDraft.ts
 *
 * Draft model for editing a saved prompt inline in the Query tab's Conversation
 * card. The editor is spread across several sibling components — the header
 * selector, the prompt bar, the composer, and the triggers editor — and a single
 * Save writes all of them at once, so the rules for turning a stored
 * {@link ISavedPrompt} into editable drafts (and back into a save request) live
 * here rather than in whichever component happens to render a given field.
 *
 * Two of those rules are easy to get wrong and are the reason this module exists.
 * The tool allowlist is three-state — absent means "every enabled tool, kept up to
 * date", which is not the same as the full list frozen at today's registry — so
 * {@link resolveToolAllowlistForSave} needs to know whether the operator actually
 * touched the picker before it can decide between sending a list and sending
 * `null`. And a trigger element's server-assigned `id` carries its run
 * bookkeeping, so drafts must round-trip that id or an edit silently re-anchors
 * the schedule and wipes the failure streak.
 *
 * All cron evaluation delegates to `savedPromptCron.ts`, which is pinned to UTC
 * to match the backend runner.
 */

import type { ISavedPrompt, ISavedPromptTrigger } from '@/types';
import type { ISavedPromptTriggerRequest } from '../../../../../modules/ai-tools';
import { describeCron, getMsUntilNextCron } from './savedPromptCron';

/**
 * Editable draft of one trigger element. Flattens both discriminants into one
 * shape so a row's inputs bind without narrowing; `key` is a stable local list
 * key (the server id for existing elements, a local counter for new ones) so
 * removing a row never re-keys its siblings and loses their input state.
 */
export interface ITriggerDraft {
    /** Stable React list key — never sent to the server. */
    key: string;
    /** Server-assigned trigger id, preserved so run bookkeeping survives edits. */
    id?: string;
    /** Discriminator: cron schedule or declared-hook binding. */
    kind: 'cron' | 'hook';
    /** Whether this trigger fires. */
    enabled: boolean;
    /** Cron expression draft (cron kind only). */
    cron: string;
    /** Declared hook id draft (hook kind only). */
    hookId: string;
    /** Optional content-type filter draft (hook kind only). */
    typeIdFilter: string;
}

/**
 * The complete editable state of a saved prompt as the Conversation card holds
 * it, gathered from the controls that own each piece. Passed to
 * {@link isPromptDirty} so the unsaved-changes indicator is derived from one
 * comparison rather than a condition duplicated per field.
 */
export interface IPromptDraft {
    /** Name field in the prompt bar. */
    name: string;
    /** Prompt body — the composer textarea, which doubles as the body editor. */
    body: string;
    /** Encoded `providerId|model` pin from the composer's model picker; `''` = unpinned. */
    modelPin: string;
    /** Tool names currently granted in the composer's Tools dropdown. */
    toolSelection: string[];
    /** Whether the operator actually engaged the Tools picker this session. */
    toolsTouched: boolean;
    /** The trigger rows as edited. */
    triggers: ITriggerDraft[];
}

/**
 * Monotonic counter behind {@link makeTriggerDraftKey}. Module-scoped on purpose:
 * the triggers editor is conditionally mounted, so a counter held in a component
 * ref resets to zero every time the section is collapsed while the parent keeps
 * the drafts — the next added row would then reuse a key already in the list, and
 * because rows are addressed by key, editing or deleting one would hit both.
 */
let nextTriggerDraftKey = 0;

/**
 * Mint a list key for a newly added trigger row, unique for the lifetime of the
 * page. Keys are local to the editor and never sent to the server; a stored
 * trigger uses its server id instead (see {@link toTriggerDrafts}).
 *
 * @returns A key no other draft row holds.
 */
export function makeTriggerDraftKey(): string {
    nextTriggerDraftKey += 1;
    return `new-${nextTriggerDraftKey}`;
}

/**
 * Map a prompt's stored triggers into editable drafts, flattening the
 * discriminated union so every row binds the same input set.
 *
 * @param triggers - The prompt's stored trigger set (absent = manual-only).
 * @returns One draft per stored trigger, keyed by the server id.
 */
export function toTriggerDrafts(triggers: ISavedPromptTrigger[] | undefined): ITriggerDraft[] {
    return (triggers ?? []).map(trigger => ({
        key: trigger.id,
        id: trigger.id,
        kind: trigger.kind,
        enabled: trigger.enabled,
        cron: trigger.kind === 'cron' ? trigger.cron : '',
        hookId: trigger.kind === 'hook' ? trigger.hookId : '',
        typeIdFilter: trigger.kind === 'hook' ? (trigger.typeIdFilter ?? '') : ''
    }));
}

/**
 * Turn the trigger drafts into the complete replacement set the save endpoint
 * expects. The server replaces the stored array wholesale and merges run
 * bookkeeping back onto elements whose `id` matches an existing trigger, so
 * every row is always sent — including untouched ones — and a row's `id` is
 * carried through verbatim.
 *
 * @param drafts - The editor's current trigger rows.
 * @returns The request shape for `POST /query/prompts`.
 */
export function toTriggerRequests(drafts: ITriggerDraft[]): ISavedPromptTriggerRequest[] {
    return drafts.map(draft => (
        draft.kind === 'cron'
            ? { id: draft.id, kind: 'cron' as const, enabled: draft.enabled, cron: draft.cron.trim() }
            : {
                id: draft.id,
                kind: 'hook' as const,
                enabled: draft.enabled,
                hookId: draft.hookId,
                ...(draft.typeIdFilter.trim() ? { typeIdFilter: draft.typeIdFilter.trim() } : {})
            }
    ));
}

/**
 * Whether any draft is unsaveable: a cron element with an empty or unparseable
 * expression, or a hook element with no hook selected. Gates the Save button so
 * the backend's 400 is never the operator's first feedback.
 *
 * @param drafts - The editor's current trigger rows.
 * @returns True when at least one row would be rejected.
 */
export function hasInvalidTriggerDraft(drafts: ITriggerDraft[]): boolean {
    return drafts.some(draft => (
        draft.kind === 'cron'
            ? describeCron(draft.cron) === null
            : !draft.hookId.trim()
    ));
}

/**
 * Summarize a prompt's trigger set for a one-line chip: the cron description for
 * a single cron, the hook id for a single hook, or a count for a mixed set —
 * enough to scan the selector without loading the prompt.
 *
 * @param triggers - The prompt's stored triggers.
 * @returns A short chip label, or null when the prompt has no triggers.
 */
export function describeTriggers(triggers: ISavedPromptTrigger[]): string | null {
    if (triggers.length === 0) {
        return null;
    }
    if (triggers.length === 1) {
        const trigger = triggers[0];
        return trigger.kind === 'cron'
            ? (describeCron(trigger.cron) ?? 'invalid cron')
            : trigger.hookId + (trigger.typeIdFilter ? ` (${trigger.typeIdFilter})` : '');
    }
    return `${triggers.length} triggers`;
}

/**
 * The most recent run timestamp across a prompt's triggers, so a "last run"
 * label covers cron and hook firings alike.
 *
 * @param triggers - The prompt's stored triggers.
 * @returns The latest `lastRunAt` ISO timestamp, or null when never run.
 */
export function latestRunAt(triggers: ISavedPromptTrigger[]): string | null {
    let latest: string | null = null;
    for (const trigger of triggers) {
        if (trigger.lastRunAt && (!latest || trigger.lastRunAt > latest)) {
            latest = trigger.lastRunAt;
        }
    }
    return latest;
}

/**
 * The soonest upcoming cron firing across a prompt's enabled cron triggers — a
 * paused trigger never fires and a hook trigger has no predictable firing time,
 * so promising a "next run" for either would mislead.
 *
 * @param triggers - The prompt's stored triggers.
 * @param now - Current epoch ms.
 * @returns Milliseconds until the next firing, or null when none is scheduled.
 */
export function msUntilNextRun(triggers: ISavedPromptTrigger[], now: number): number | null {
    let soonest: number | null = null;
    for (const trigger of triggers) {
        if (trigger.kind !== 'cron' || !trigger.enabled) {
            continue;
        }
        const ms = getMsUntilNextCron(trigger.cron, now);
        if (ms !== null && (soonest === null || ms < soonest)) {
            soonest = ms;
        }
    }
    return soonest;
}

/**
 * Encode a prompt's provider + model pin as the single value the model picker
 * binds to. Models span providers, so the model id alone is ambiguous about
 * which transport a scheduled run should use — the pair travels as one string
 * so a `<select>` can carry it.
 *
 * @param prompt - The prompt whose pin to encode, or null for an unsaved draft.
 * @returns `providerId|model`, or `''` when the prompt pins nothing.
 */
export function encodeModelPin(prompt: ISavedPrompt | null): string {
    return prompt?.providerId && prompt.model ? `${prompt.providerId}|${prompt.model}` : '';
}

/**
 * Split an encoded picker value back into its provider and model halves.
 * Returns nulls for the empty value so the save request clears an existing pin
 * rather than leaving it in place.
 *
 * @param value - The encoded `providerId|model` value from the picker.
 * @returns The provider id and model id, both null when nothing is pinned.
 */
export function decodeModelPin(value: string): { providerId: string | null; model: string | null } {
    const separator = value.indexOf('|');
    return separator >= 0
        ? { providerId: value.slice(0, separator), model: value.slice(separator + 1) }
        : { providerId: null, model: null };
}

/**
 * Decide what to send for `toolAllowlist`, preserving the field's three-state
 * contract. A prompt that already carries an explicit allowlist (including `[]`),
 * or one whose picker the operator actually edited, saves the selection verbatim.
 * An *unset* prompt left untouched saves `null` so the server unsets the field
 * back to "all enabled, auto-updating" — without this, the display-only prefill
 * of today's enabled tools would freeze the prompt to that set and silently
 * exclude every tool enabled later.
 *
 * @param prompt - The stored prompt, or null when creating a new one.
 * @param selection - The picker's current tool names.
 * @param touched - Whether the operator engaged the picker this session.
 * @returns The array to persist, or null to clear the restriction.
 */
export function resolveToolAllowlistForSave(
    prompt: ISavedPrompt | null,
    selection: string[],
    touched: boolean
): string[] | null {
    return (touched || prompt?.toolAllowlist !== undefined) ? selection : null;
}

/**
 * Whether two tool-name selections differ, ignoring order. The picker builds its
 * array in registry order while the server returns whatever order it stored, so
 * a positional comparison would report a phantom unsaved change on load.
 *
 * @param left - One selection.
 * @param right - The other selection.
 * @returns True when the two grant different sets of tools.
 */
function toolSetsDiffer(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return true;
    }
    const known = new Set(left);
    return right.some(name => !known.has(name));
}

/**
 * Whether the trigger drafts differ from what is stored. Compares only the
 * fields the editor can change — identity, kind, enabled state, and the
 * kind-specific values — because run bookkeeping is server-owned and would
 * otherwise report every prompt as dirty the moment a schedule fired.
 *
 * @param stored - The prompt's stored triggers.
 * @param drafts - The editor's current rows.
 * @returns True when saving would change the trigger set.
 */
function triggersDiffer(stored: ISavedPromptTrigger[], drafts: ITriggerDraft[]): boolean {
    if (stored.length !== drafts.length) {
        return true;
    }
    return drafts.some((draft, index) => {
        const trigger = stored[index];
        if (draft.id !== trigger.id || draft.kind !== trigger.kind || draft.enabled !== trigger.enabled) {
            return true;
        }
        if (trigger.kind === 'cron') {
            return draft.cron.trim() !== trigger.cron;
        }
        return draft.hookId !== trigger.hookId
            || draft.typeIdFilter.trim() !== (trigger.typeIdFilter ?? '');
    });
}

/**
 * Whether the editor holds changes the stored prompt does not have yet. Drives
 * the prompt bar's unsaved dot — the only signal an operator gets that the
 * composer text they are iterating on has diverged from what a schedule would
 * fire, so it has to account for every field the single Save writes.
 *
 * @param prompt - The stored prompt, or null when creating a new one (always dirty).
 * @param draft - The editor's current state across all its controls.
 * @returns True when Save would write something different.
 */
export function isPromptDirty(prompt: ISavedPrompt | null, draft: IPromptDraft): boolean {
    if (!prompt) {
        return true;
    }
    if (draft.name.trim() !== prompt.name || draft.body.trim() !== prompt.prompt) {
        return true;
    }
    if (draft.modelPin !== encodeModelPin(prompt)) {
        return true;
    }
    const nextAllowlist = resolveToolAllowlistForSave(prompt, draft.toolSelection, draft.toolsTouched);
    if (nextAllowlist === null) {
        if (prompt.toolAllowlist !== undefined) {
            return true;
        }
    } else if (prompt.toolAllowlist === undefined || toolSetsDiffer(prompt.toolAllowlist, nextAllowlist)) {
        return true;
    }
    return triggersDiffer(prompt.triggers ?? [], draft.triggers);
}
