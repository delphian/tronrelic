'use client';

/**
 * @file ToolAllowlistPicker.tsx
 *
 * Checkbox multiselect for a saved prompt's per-run tool allowlist. Least
 * privilege is opt-in narrowing: a new prompt starts with every enabled tool
 * selected (seeded by the parent), and the operator unchecks down to the set the
 * prompt actually needs. An empty selection is a valid, meaningful state — "no
 * tools" — so the picker surfaces it rather than treating it as unset.
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
import styles from './ToolAllowlistPicker.module.scss';

interface ToolAllowlistPickerProps {
    /** Every registered tool (enabled and disabled), for the option list. */
    tools: IAiToolInfo[];
    /** Currently-selected tool names. */
    selected: string[];
    /** Called with the next selection whenever a checkbox or bulk action toggles. */
    onChange: (names: string[]) => void;
    /** Disable interaction while a save is in flight. */
    disabled?: boolean;
}

/**
 * Render the tool allowlist checkbox list with a count header and bulk
 * select-enabled / clear actions.
 *
 * Disabled tools are shown (marked) rather than hidden so a tool that was
 * selected and later disabled never silently drops out of the prompt's
 * allowlist — the operator sees and keeps it, and the governor intersects with
 * the live enabled set at run time.
 *
 * @param props.tools - All registered tools to offer as options.
 * @param props.selected - The currently-checked tool names.
 * @param props.onChange - Receives the next selection.
 * @param props.disabled - Whether the controls are inert during a save.
 * @returns The picker.
 */
export function ToolAllowlistPicker({ tools, selected, onChange, disabled = false }: ToolAllowlistPickerProps) {
    const selectedSet = useMemo(() => new Set(selected), [selected]);

    // Enabled tools first, then alphabetical, so the actionable options lead and
    // any disabled-but-selected leftovers sink to the bottom.
    const ordered = useMemo(
        () => [...tools].sort((a, b) => {
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        }),
        [tools]
    );

    const enabledNames = useMemo(() => tools.filter(tool => tool.enabled).map(tool => tool.name), [tools]);

    /**
     * Flip one tool's membership in the selection.
     *
     * @param name - The tool name toggled.
     */
    const toggle = (name: string): void => {
        if (selectedSet.has(name)) {
            onChange(selected.filter(entry => entry !== name));
        } else {
            onChange([...selected, name]);
        }
    };

    return (
        <div className={styles.picker}>
            <div className={styles.header}>
                <span className={styles.count}>
                    {selected.length} of {tools.length} selected
                </span>
                <div className={styles.header_actions}>
                    <button
                        type="button"
                        className={styles.link_btn}
                        onClick={() => onChange(enabledNames)}
                        disabled={disabled || enabledNames.length === 0}
                    >
                        All enabled
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

            {tools.length === 0 ? (
                <p className={styles.empty}>No tools registered.</p>
            ) : (
                <ul className={styles.list}>
                    {ordered.map(tool => (
                        <li key={tool.name}>
                            <label className={styles.check_label}>
                                <input
                                    type="checkbox"
                                    checked={selectedSet.has(tool.name)}
                                    onChange={() => toggle(tool.name)}
                                    disabled={disabled}
                                />
                                <span className={styles.tool_name}>{tool.name}</span>
                                {!tool.enabled && <span className={styles.disabled_tag}>(disabled)</span>}
                            </label>
                        </li>
                    ))}
                </ul>
            )}

            {selected.length === 0 && (
                <p className={styles.warning}>
                    <AlertCircle size={12} /> This prompt will run with no tools.
                </p>
            )}
        </div>
    );
}
