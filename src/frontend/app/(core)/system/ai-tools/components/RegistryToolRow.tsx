'use client';

/**
 * @fileoverview One Registry Tools row: the tool's identity, provider,
 * capability badges, and enable toggle, with a chevron that discloses an inline
 * policy editor. The editor lives behind the chevron rather than in adjacent
 * columns so the row stays scannable and the trifecta-arming policy knobs keep a
 * deliberate click between them and the everyday enable toggle — the reason the
 * former standalone Policy tab folded into the Registry here.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { IAiToolInfo, IToolPolicy } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';
import { Switch } from '../../../../../components/ui/Switch';
import { Tr, Td } from '../../../../../components/ui/Table';
import type { IPolicyResponse } from '../../../../../modules/ai-tools';
import { CapabilityBadges } from './CapabilityBadges';
import { ToolPolicyEditor } from './ToolPolicyEditor';
import styles from '../page.module.scss';

/** Usage tally shape from `GET /policy`. */
type Usage = IPolicyResponse['usage'][string];

/**
 * A tool's main row plus its collapsible policy editor.
 *
 * @param props.tool - The tool to render (name, description, provider, capability, enabled state).
 * @param props.override - The tool's saved policy override, or undefined when it runs on class defaults; presence drives the "override" badge.
 * @param props.usage - Audit-trail tallies passed through to the editor.
 * @param props.defaults - The governor's resolved class defaults passed through to the editor.
 * @param props.busy - Whether an enable toggle for this tool is in flight, disabling the switch.
 * @param props.columnCount - Total column count, so the expanded editor cell can span the full table width.
 * @param props.onToggle - Enable/disable handler the parent owns (it reloads and re-checks the trifecta).
 * @param props.onPolicyChanged - Called after a save/clear so the parent refetches policy and the trifecta.
 * @returns The row fragment (main row, and the editor row while expanded).
 */
export function RegistryToolRow({ tool, override, usage, defaults, busy, columnCount, onToggle, onPolicyChanged }: {
    tool: IAiToolInfo;
    override?: IToolPolicy;
    usage?: Usage;
    defaults?: { requireApproval: boolean; allowUnattended: boolean };
    busy: boolean;
    columnCount: number;
    onToggle: (name: string, enabled: boolean) => void;
    onPolicyChanged: () => void;
}) {
    const [open, setOpen] = useState(false);
    const hasOverride = override !== undefined;

    return (
        <>
            <Tr>
                <Td>
                    <button
                        type="button"
                        className={styles.expand_button}
                        onClick={() => setOpen(current => !current)}
                        aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Edit'} policy for ${tool.name}`}
                    >
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                </Td>
                <Td>
                    <div className={styles.tool_cell}>
                        <span className={styles.tool_name}>{tool.name}</span>
                        {hasOverride && <Badge tone="info">override</Badge>}
                    </div>
                    <div className={styles.tool_desc}>{tool.description}</div>
                </Td>
                <Td muted>{tool.provider}</Td>
                <Td><CapabilityBadges capability={tool.capability} /></Td>
                <Td>
                    <Switch
                        on={tool.enabled}
                        onChange={(next) => onToggle(tool.name, next)}
                        disabled={busy}
                        aria-label={`${tool.enabled ? 'Disable' : 'Enable'} ${tool.name}`}
                    />
                </Td>
            </Tr>
            {open && (
                <Tr isExpanded>
                    <Td colSpan={columnCount}>
                        <ToolPolicyEditor
                            tool={tool}
                            override={override}
                            usage={usage}
                            defaults={defaults}
                            onChanged={onPolicyChanged}
                        />
                    </Td>
                </Tr>
            )}
        </>
    );
}
