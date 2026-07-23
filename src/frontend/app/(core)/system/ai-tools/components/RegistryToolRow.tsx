'use client';

/**
 * @fileoverview One Registry Tools row, reshaped for fast triage. The two
 * questions an operator asks first — is it live, and how dangerous is it — lead
 * the row as the enable toggle and the single dominant risk chip; the name and a
 * one-line description teaser follow. The full model-facing description, the
 * parameter schema, and the policy editor moved off the row into the slide-over
 * (opened by clicking the row or the name) so the list stays scannable instead
 * of every row unrolling a wall of model-facing prose.
 *
 * The enable switch and its cell stop click propagation so toggling a tool never
 * also opens the panel; everything else on the row is a path into the detail.
 */

import type { MouseEvent } from 'react';
import type { IAiToolInfo } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';
import { Switch } from '../../../../../components/ui/Switch';
import { Tr, Td } from '../../../../../components/ui/Table';
import { RiskChip } from './RiskChip';
import styles from '../page.module.scss';

/**
 * A single tool's registry row.
 *
 * @param props.tool - The tool to render (enabled, capability, name, description).
 * @param props.hasOverride - Whether the tool carries a saved policy override; drives the "override" badge.
 * @param props.busy - Whether an enable toggle for this tool is in flight, disabling the switch.
 * @param props.indented - Indents the row's leading cell so it nests visually under its
 *                         provider-section header. The registry lists tools grouped by
 *                         provider, so the provider is named once on the section header
 *                         rather than repeated per row.
 * @param props.onToggle - Enable/disable handler the parent owns (reloads and re-checks the trifecta).
 * @param props.onSelect - Opens the detail slide-over for this tool.
 * @returns The table row.
 */
export function RegistryToolRow({ tool, hasOverride, busy, indented = false, onToggle, onSelect }: {
    tool: IAiToolInfo;
    hasOverride: boolean;
    busy: boolean;
    indented?: boolean;
    onToggle: (name: string, enabled: boolean) => void;
    onSelect: (tool: IAiToolInfo) => void;
}) {
    /**
     * Keep a click inside the enable cell from bubbling to the row's open
     * handler, so toggling a tool never also opens the panel.
     *
     * @param event - The cell click event.
     */
    const stopCellClick = (event: MouseEvent<HTMLTableCellElement>) => {
        event.stopPropagation();
    };

    return (
        <Tr className={styles.tool_row} onClick={() => onSelect(tool)}>
            <Td onClick={stopCellClick} className={indented ? styles.tool_indent : undefined}>
                <Switch
                    on={tool.enabled}
                    onChange={(next) => onToggle(tool.name, next)}
                    disabled={busy}
                    aria-label={`${tool.enabled ? 'Disable' : 'Enable'} ${tool.name}`}
                />
            </Td>
            <Td><RiskChip capability={tool.capability} /></Td>
            <Td>
                <div className={styles.tool_cell}>
                    <button
                        type="button"
                        className={styles.tool_name_button}
                        onClick={(event) => { event.stopPropagation(); onSelect(tool); }}
                    >
                        {tool.name}
                    </button>
                    {hasOverride && <Badge tone="info">override</Badge>}
                </div>
            </Td>
            <Td><span className={styles.tool_teaser}>{tool.description}</span></Td>
        </Tr>
    );
}
