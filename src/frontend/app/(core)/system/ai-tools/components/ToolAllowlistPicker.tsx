'use client';

/**
 * @file ToolAllowlistPicker.tsx
 *
 * Checkbox multiselect for a saved prompt's per-run tool allowlist. Least
 * privilege is opt-in narrowing: a new prompt starts with everything currently
 * switched on selected (seeded by the parent), and the operator unchecks down to
 * the set the prompt actually needs. An empty selection is a valid, meaningful
 * state — "no tools" — so the picker surfaces it rather than treating it as
 * unset.
 *
 * The list is split into two groups, because the two kinds of tool answer to
 * different authorities and an operator has to be able to tell them apart.
 * Registry tools are governed: every call passes through the core tool governor,
 * which validates the input, applies policy, and writes an audit record.
 * Provider-hosted tools run on the AI vendor's own infrastructure, so the
 * governor never sees the call, and leaving one out of this selection is the
 * only thing that stops it running. Flattening both into one list would hide a
 * difference that changes what a grant costs.
 *
 * The project has no shared MultiSelect primitive; this mirrors the established
 * checkbox-list pattern (see SystemPromptsSection's audience picker) with tokens
 * and semantic `<label><input type="checkbox">` markup. Purely presentational —
 * the parent owns the selection state, fetch, persistence, and the trifecta
 * badge that reacts to changes here.
 */

import { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import type { IAiToolInfo } from '@/types';
import { HOSTED_TOOL_PREFIX, hostedToolEntry, isHostedToolEntry } from '@/types';
import styles from './ToolAllowlistPicker.module.scss';

interface ToolAllowlistPickerProps {
    /** Every registered governed tool (enabled and disabled), for the option list. */
    tools: IAiToolInfo[];
    /**
     * Provider-hosted tools available to the run being edited, as the provider
     * reports them for the model this run will use. Already filtered to what the
     * provider config has switched on, so every entry here is genuinely
     * grantable. Empty when no provider is installed or none are switched on.
     */
    hostedTools: IAiToolInfo[];
    /**
     * Currently-selected allowlist entries. A governed tool appears as its plain
     * name; a hosted tool appears with the `hosted:` prefix, which is the form
     * stored on the prompt and sent on the wire.
     */
    selected: string[];
    /** Called with the next selection whenever a checkbox or bulk action toggles. */
    onChange: (names: string[]) => void;
    /** Disable interaction while a save is in flight. */
    disabled?: boolean;
}

/** One rendered checkbox: the entry it writes, plus what to show beside it. */
interface IPickerOption {
    /** The allowlist entry this option adds to or removes from the selection. */
    value: string;
    /** The tool's own name, shown to the operator without any prefix. */
    label: string;
    /** Whether the tool can currently run at all; a switched-off one still shows. */
    enabled: boolean;
}

/**
 * Render the tool allowlist checkbox list with a count header, bulk
 * select-everything / clear actions, and the two groups kept apart.
 *
 * Disabled registry tools are shown (marked) rather than hidden, so a tool that
 * was selected and later disabled never silently drops out of the prompt's
 * allowlist — the operator sees it and keeps it, and the governor intersects
 * with the live enabled set at run time.
 *
 * The hosted group follows the same rule for the same reason. The provider
 * reports only the tools it would currently run, so a granted hosted name it
 * does not report would otherwise render no row while staying in the selection
 * and still saving — a grant the operator can neither see nor remove. Those
 * entries are shown as unavailable instead. The wording differs from the
 * governed group's because the cause is not necessarily a deliberate switch: the
 * provider reports nothing when its own read fails, so the row claims only that
 * the entry is not grantable right now.
 *
 * @param props.tools - All registered governed tools to offer as options.
 * @param props.hostedTools - The provider-hosted tools available to this run.
 * @param props.selected - The currently-checked allowlist entries.
 * @param props.onChange - Receives the next selection.
 * @param props.disabled - Whether the controls are inert during a save.
 * @returns The picker.
 */
export function ToolAllowlistPicker({
    tools,
    hostedTools,
    selected,
    onChange,
    disabled = false
}: ToolAllowlistPickerProps) {
    const selectedSet = useMemo(() => new Set(selected), [selected]);

    // Enabled tools first, then alphabetical, so the actionable options lead and
    // any disabled-but-selected leftovers sink to the bottom.
    const registryOptions = useMemo<IPickerOption[]>(
        () => [...tools]
            .sort((a, b) => {
                if (a.enabled !== b.enabled) {
                    return a.enabled ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            })
            .map(tool => ({ value: tool.name, label: tool.name, enabled: tool.enabled })),
        [tools]
    );

    // Available entries first, then any granted name the provider is not
    // reporting, so the actionable options lead and the leftovers sink — the same
    // ordering the governed group uses for a disabled-but-selected tool.
    const hostedOptions = useMemo<IPickerOption[]>(
        () => {
            const reported = new Set(hostedTools.map(tool => tool.name));
            const available = [...hostedTools]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(tool => ({ value: hostedToolEntry(tool.name), label: tool.name, enabled: true }));
            // A hosted grant the provider does not currently report still sits in
            // the selection and still saves, so hiding it would leave a grant the
            // operator can neither see nor remove, and would make the count larger
            // than the rows shown. The provider reports an empty list for several
            // different reasons — the tool switched off, removed, a different
            // provider answering, or a failed read — so the row says only that the
            // entry is not grantable right now.
            const unavailable = selected
                .filter(entry => isHostedToolEntry(entry) && !reported.has(entry.slice(HOSTED_TOOL_PREFIX.length)))
                .sort((a, b) => a.localeCompare(b))
                .map(entry => ({ value: entry, label: entry.slice(HOSTED_TOOL_PREFIX.length), enabled: false }));

            return [...available, ...unavailable];
        },
        [hostedTools, selected]
    );

    const totalCount = registryOptions.length + hostedOptions.length;

    /**
     * Every entry that is currently switched on somewhere — the selection that
     * reproduces what a run with no allowlist at all does. This is what the
     * bulk action writes, and it deliberately includes the hosted tools: an
     * unrestricted prompt really does run with them, so a bulk action that
     * quietly left them out would produce a narrower prompt than the operator
     * believed they had asked for. A hosted entry the provider is not reporting
     * is left out, because naming one the provider cannot host fails the run.
     */
    const availableValues = useMemo(
        () => [
            ...registryOptions.filter(option => option.enabled).map(option => option.value),
            ...hostedOptions.filter(option => option.enabled).map(option => option.value)
        ],
        [registryOptions, hostedOptions]
    );

    /**
     * Flip one entry's membership in the selection.
     *
     * @param value - The allowlist entry toggled, already in its stored form, so
     *        no caller has to know whether that form carries a prefix.
     */
    const toggle = (value: string): void => {
        if (selectedSet.has(value)) {
            onChange(selected.filter(entry => entry !== value));
        } else {
            onChange([...selected, value]);
        }
    };

    /**
     * Render one group's checkbox rows. Extracted because the two groups differ
     * only in their heading and their per-row annotation, and duplicating the
     * list markup would let the two drift apart as either group changes.
     *
     * @param options - The rows to render, already in display order.
     * @param unavailableTag - What to show beside a row that cannot currently
     *        run. The two groups need different words: a governed tool is
     *        deliberately switched off, while a hosted one is merely not being
     *        reported, which may only mean the provider read failed.
     * @returns The list element for that group.
     */
    const renderGroup = (options: IPickerOption[], unavailableTag: string) => (
        <ul className={styles.list}>
            {options.map(option => (
                <li key={option.value}>
                    <label className={styles.check_label}>
                        <input
                            type="checkbox"
                            checked={selectedSet.has(option.value)}
                            onChange={() => toggle(option.value)}
                            disabled={disabled}
                        />
                        <span className={styles.tool_name}>{option.label}</span>
                        {!option.enabled && <span className={styles.disabled_tag}>{unavailableTag}</span>}
                    </label>
                </li>
            ))}
        </ul>
    );

    return (
        <div className={styles.picker}>
            <div className={styles.header}>
                <span className={styles.count}>
                    {selected.length} of {totalCount} selected
                </span>
                <div className={styles.header_actions}>
                    <button
                        type="button"
                        className={styles.link_btn}
                        onClick={() => onChange(availableValues)}
                        disabled={disabled || availableValues.length === 0}
                    >
                        All available
                    </button>
                    <button
                        type="button"
                        className={styles.link_btn}
                        onClick={() => onChange([])}
                        disabled={disabled || selected.length === 0}
                    >
                        None
                    </button>
                </div>
            </div>

            {totalCount === 0 ? (
                <p className={styles.empty}>No tools registered.</p>
            ) : (
                <>
                    {registryOptions.length > 0 && (
                        <>
                            <span className={styles.group_label}>Governed tools</span>
                            {renderGroup(registryOptions, '(disabled)')}
                        </>
                    )}
                    {hostedOptions.length > 0 && (
                        <>
                            <span className={styles.group_label}>Provider-hosted</span>
                            {renderGroup(hostedOptions, '(unavailable)')}
                            <p className={styles.group_note}>
                                These run on the AI provider&rsquo;s own servers. The tool governor cannot
                                apply policy, approval, or rate limits to them, so leaving one unchecked
                                is what stops it running.
                            </p>
                        </>
                    )}
                </>
            )}

            {selected.length === 0 && (
                <p className={styles.warning}>
                    <AlertCircle size={12} /> This prompt will run with no tools.
                </p>
            )}
        </div>
    );
}
