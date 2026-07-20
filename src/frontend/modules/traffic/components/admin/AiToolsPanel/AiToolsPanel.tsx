'use client';

/**
 * AI tab of the /system/traffic admin page.
 *
 * Surfaces the traffic module's own AI tools — the model-facing view of the
 * analytics surface — so an operator can see exactly what a model may ask about
 * visitors, crawlers, search, and redirects, and switch each tool off without
 * leaving the traffic admin.
 *
 * Reads and toggles proxy through the module's admin routes
 * (/api/admin/users/analytics/ai-tools*), which filter the core registry to this
 * module's tools. The enabled state lives in core, so a toggle here is the same
 * switch the /system/ai-tools Registry tab flips.
 *
 * Admin-only panel — no SSR data fetching; admin pages fetch client-side after
 * auth, so the initial load state here is the permitted admin case.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Card } from '../../../../../components/ui/Card';
import { Badge } from '../../../../../components/ui/Badge';
import { Switch } from '../../../../../components/ui/Switch';
import { Skeleton } from '../../../../../components/ui/Skeleton';
import { Stack } from '../../../../../components/layout';
import { adminGetTrafficAiTools, adminSetTrafficAiToolEnabled } from '../../../api/client';
import type { IAiToolSummary } from '../../../api/client';
import styles from './AiToolsPanel.module.scss';

/** Badge tone per side-effect class, so risk reads at a glance. */
const SIDE_EFFECT_TONES: Record<string, 'info' | 'warning' | 'danger'> = {
    read: 'info',
    write: 'warning',
    external: 'danger'
};

/** Tone options the Badge component accepts, narrowed for the badge builder. */
type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * Reduce a tool's capability declaration to the badge row the card shows.
 *
 * The untrusted-content flag gets its own badge because it is the one
 * classification an operator most needs to see here: it means the tool returns
 * text an outsider authored (a User-Agent, a search query), which is the
 * ingress leg of the lethal trifecta.
 *
 * @param capability - The tool's declared governance classification.
 * @returns Label/tone pairs for the badges, most significant first.
 */
function capabilityBadges(capability: IAiToolSummary['capability']): Array<{ label: string; tone: BadgeTone }> {
    const badges: Array<{ label: string; tone: BadgeTone }> = [];
    if (capability?.sideEffect) {
        badges.push({ label: capability.sideEffect, tone: SIDE_EFFECT_TONES[capability.sideEffect] ?? 'neutral' });
    }
    if (capability?.sensitivity) {
        badges.push({ label: capability.sensitivity, tone: 'neutral' });
    }
    if (capability?.surfacesUntrustedContent) {
        badges.push({ label: 'untrusted content', tone: 'warning' });
    }
    if (capability?.spendsMoney) {
        badges.push({ label: 'spends money', tone: 'danger' });
    }
    return badges;
}

/**
 * Render the traffic module's AI tool cards with enable/disable switches.
 */
export function AiToolsPanel() {
    const [tools, setTools] = useState<IAiToolSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Names of every tool whose toggle PATCH is in flight. A set, not a single
    // name: with one slot a second tool's toggle would clear the first tool's
    // lock while its PATCH is still pending, re-enabling that switch and letting
    // two PATCHes for the same tool settle out of order — leaving the card
    // showing an enabled state the registry never persisted.
    const [busyTools, setBusyTools] = useState<ReadonlySet<string>>(() => new Set<string>());

    /**
     * Load this module's tools from the admin proxy. A failed read surfaces an
     * error rather than an empty list, which an operator would misread as "the
     * traffic module registers no AI tools".
     */
    const loadTools = useCallback(async () => {
        try {
            setTools(await adminGetTrafficAiTools());
            setError(null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
    }, []);

    useEffect(() => {
        void loadTools();
    }, [loadTools]);

    /**
     * Persist one tool's enabled state. Optimistic — the switch responds
     * instantly and reverts if the PATCH fails, so the UI never claims a state
     * the registry rejected.
     *
     * @param name - The tool being toggled.
     * @param next - The switch's new position.
     */
    const toggleTool = useCallback(async (name: string, next: boolean) => {
        setBusyTools(current => new Set(current).add(name));
        setTools(current => current?.map(tool => (tool.name === name ? { ...tool, enabled: next } : tool)) ?? current);
        try {
            await adminSetTrafficAiToolEnabled(name, next);
            setError(null);
        } catch (toggleError) {
            setTools(current => current?.map(tool => (tool.name === name ? { ...tool, enabled: !next } : tool)) ?? current);
            setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
        } finally {
            setBusyTools(current => {
                const remaining = new Set(current);
                remaining.delete(name);
                return remaining;
            });
        }
    }, []);

    return (
        <Stack gap="md">
            <p className="text-muted">
                Tools the AI assistant may call against traffic analytics. The switch is the same enabled state the
                central <Link className="link" href="/system/ai-tools">AI tool registry</Link> governs — disabling a tool here
                removes it from every AI query. Per-visitor clickstreams are deliberately not exposed to any tool.
            </p>

            {error !== null && (
                <Card>
                    <div className={styles.error_row}>
                        <ShieldAlert size={18} aria-hidden="true" />
                        <span>{error}</span>
                    </div>
                </Card>
            )}

            {tools === null && error === null && (
                <Card><Skeleton style={{ height: '4em' }} /></Card>
            )}

            {tools !== null && tools.length === 0 && (
                <Card>
                    <p className="text-muted">
                        No traffic AI tools are registered. The core AI tools module may be unavailable.
                    </p>
                </Card>
            )}

            {tools?.map(tool => (
                <Card key={tool.name}>
                    <Stack gap="sm">
                        <div className={styles.tool_header}>
                            <div className={styles.tool_identity}>
                                <code className={styles.tool_name}>{tool.name}</code>
                                <span className={styles.tool_badges}>
                                    {capabilityBadges(tool.capability).map(badge => (
                                        <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>
                                    ))}
                                </span>
                            </div>
                            <Switch
                                on={tool.enabled}
                                onChange={next => void toggleTool(tool.name, next)}
                                disabled={busyTools.has(tool.name)}
                                aria-label={`Toggle the ${tool.name} AI tool`}
                            />
                        </div>
                        <div className={styles.tool_section}>
                            <span className={styles.tool_section_label}>Description prompt</span>
                            <p className={styles.tool_description}>{tool.description}</p>
                        </div>
                        {(tool.inputExamples?.length ?? 0) > 0 && (
                            <div className={styles.tool_section}>
                                <span className={styles.tool_section_label}>Input examples</span>
                                <div className={styles.tool_examples}>
                                    {tool.inputExamples?.map((example, index) => (
                                        <pre key={index} className={styles.tool_example}>
                                            {JSON.stringify(example, null, 2)}
                                        </pre>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Stack>
                </Card>
            ))}
        </Stack>
    );
}
