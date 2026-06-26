'use client';

/**
 * @fileoverview Slide-over body for one registry tool — the detail half of the
 * master-detail registry. It holds the surfaces too heavy for a list row: the
 * full model-facing description (the field that dominates tool selection, so an
 * admin must be able to read it in full), the input-parameter schema, and the
 * policy override editor. Tabs keep the panel scannable instead of one long
 * scroll, and the always-on meta strip (provider, full capability badges, the
 * enable toggle) gives triage context regardless of the active tab.
 *
 * The panel reads its live tool/override from props the parent refetches on any
 * change, so editing policy here and toggling enable stay in sync with the list
 * behind it.
 */

import { useState } from 'react';
import type { IAiToolInfo, IToolPolicy } from '@/types';
import { cn } from '../../../../../lib/cn';
import { Switch } from '../../../../../components/ui/Switch';
import type { IPolicyResponse } from '../../../../../modules/ai-tools';
import { CapabilityBadges } from './CapabilityBadges';
import { ToolPolicyEditor } from './ToolPolicyEditor';
import { ToolSchemaView } from './ToolSchemaView';
import styles from '../page.module.scss';

/** Usage tally shape from `GET /policy`. */
type Usage = IPolicyResponse['usage'][string];

/** Which detail surface is showing. */
type DetailTab = 'description' | 'policy' | 'schema';

/**
 * The detail panel for one tool, rendered inside the SlideOver body.
 *
 * @param props.tool - The selected tool (live — re-derived from the parent's list on every reload).
 * @param props.override - The tool's saved policy override, passed through to the editor.
 * @param props.usage - Audit-trail tallies passed through to the editor.
 * @param props.defaults - The governor's resolved class defaults passed through to the editor.
 * @param props.busy - Whether an enable toggle for this tool is in flight, disabling the switch.
 * @param props.onToggle - Enable/disable handler the parent owns (reloads and re-checks the trifecta).
 * @param props.onPolicyChanged - Called after a save/clear so the parent refetches policy and the trifecta.
 * @returns The tabbed detail body.
 */
export function ToolDetailPanel({ tool, override, usage, defaults, busy, onToggle, onPolicyChanged }: {
    tool: IAiToolInfo;
    override?: IToolPolicy;
    usage?: Usage;
    defaults?: { requireApproval: boolean; allowUnattended: boolean };
    busy: boolean;
    onToggle: (name: string, enabled: boolean) => void;
    onPolicyChanged: () => void;
}) {
    const [tab, setTab] = useState<DetailTab>('description');
    const propertyCount = Object.keys(tool.inputSchema?.properties ?? {}).length;

    return (
        <div className={styles.detail}>
            <div className={styles.detail_meta}>
                <div className={styles.detail_meta_row}>
                    <span className="text-muted">{tool.provider}</span>
                    <Switch
                        on={tool.enabled}
                        onChange={(next) => onToggle(tool.name, next)}
                        disabled={busy}
                        aria-label={`${tool.enabled ? 'Disable' : 'Enable'} ${tool.name}`}
                    />
                </div>
                <CapabilityBadges capability={tool.capability} />
            </div>

            <div className={cn('segmented-control', styles.detail_tabs)} role="tablist" aria-label="Tool detail sections">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'description'}
                    className={cn(tab === 'description' && 'is-active')}
                    onClick={() => setTab('description')}
                >
                    Description
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'policy'}
                    className={cn(tab === 'policy' && 'is-active')}
                    onClick={() => setTab('policy')}
                >
                    Policy
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'schema'}
                    className={cn(tab === 'schema' && 'is-active')}
                    onClick={() => setTab('schema')}
                >
                    Schema{propertyCount ? ` (${propertyCount})` : ''}
                </button>
            </div>

            {tab === 'description' && (
                <p className={styles.detail_description}>{tool.description}</p>
            )}
            {tab === 'policy' && (
                <ToolPolicyEditor
                    tool={tool}
                    override={override}
                    usage={usage}
                    defaults={defaults}
                    onChanged={onPolicyChanged}
                />
            )}
            {tab === 'schema' && (
                <ToolSchemaView schema={tool.inputSchema} />
            )}
        </div>
    );
}
