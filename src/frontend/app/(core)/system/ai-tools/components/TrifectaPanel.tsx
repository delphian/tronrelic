'use client';

/**
 * @fileoverview Operator banner for the lethal-trifecta check. When the enabled
 * tool set co-presents a secret-data reader, an untrusted-content source, and an
 * external exfiltration channel, injected text can read a secret and send it out
 * in one turn. The banner renders three states off `status.severity`: `safe`
 * (none of the dangerous co-presence), `supervised` (all three present but every
 * off-platform channel forces curator review, so nothing leaves without a human
 * — a caution, not an all-clear), and `lethal` (all three present with an open,
 * autonomously closable channel). It names the contributing tools so an operator
 * can break the chain by disabling one leg.
 */

import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ITrifectaStatus } from '@/types';
import { Card } from '../../../../../components/ui/Card';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack } from '../../../../../components/layout';
import styles from '../page.module.scss';

/** Badge tone used to colour a leg's contributing tools. */
type LegTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** One trifecta leg: its label and the enabled tools that contribute it. */
function Leg({ label, tools, tone }: { label: string; tools: string[]; tone: LegTone }) {
    return (
        <div>
            <div className={styles.trifecta_leg_label}>{label}</div>
            <span className={styles.badges}>
                {tools.length === 0
                    ? <span className="text-subtle">none</span>
                    : tools.map(name => <Badge key={name} tone={tone}>{name}</Badge>)}
            </span>
        </div>
    );
}

/**
 * Render the trifecta banner. `safe` shows a compact reassurance line; `lethal`
 * and `supervised` each show a tone-matched danger card naming the three legs,
 * with the exfiltration leg split into open (danger) and curator-gated (warning)
 * channels so the operator sees why a state is amber rather than red.
 *
 * @param props.status - The current trifecta status over the enabled set.
 * @returns The banner.
 */
export function TrifectaPanel({ status }: { status: ITrifectaStatus }) {
    if (status.severity === 'safe') {
        return (
            <div className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)', fontSize: 'var(--font-size-body-sm)' }}>
                <ShieldCheck size={16} style={{ color: 'var(--color-success)' }} />
                No lethal trifecta — the enabled set does not combine private-data, untrusted-content, and exfiltration tools.
            </div>
        );
    }

    const supervised = status.severity === 'supervised';
    const accent = supervised
        ? { color: 'var(--color-warning)', text: 'var(--color-warning-text)', border: 'var(--color-warning-alpha-40)', tone: 'warning' as const }
        : { color: 'var(--color-danger)', text: 'var(--color-danger-text)', border: 'var(--color-danger-alpha-50)', tone: 'danger' as const };
    const Icon = supervised ? ShieldAlert : AlertTriangle;

    return (
        <Card tone="accent" style={{ borderColor: accent.border }}>
            <Stack gap="sm">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
                    <Icon size={18} style={{ color: accent.color }} />
                    <strong style={{ color: accent.text }}>
                        {supervised ? 'Trifecta present — exfiltration is curator-gated' : 'Lethal trifecta present'}
                    </strong>
                </div>
                <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                    {supervised
                        ? 'All three capabilities are enabled, but every off-platform channel forces curator review — injected text cannot exfiltrate autonomously, since a human releases each outbound effect. Residual risk remains: a reviewer must read the raw payload to catch a disguised one, so keep the review queue focused enough that approvals stay meaningful.'
                        : 'The enabled tools combine all three legs with an open off-platform channel, so prompt-injected text could read a secret and exfiltrate it in one turn. Disable one leg below to break the chain.'}
                </p>
                <div className={styles.trifecta_legs}>
                    <Leg label="Private data" tools={status.privateData} tone={accent.tone} />
                    <Leg label="Untrusted content" tools={status.untrustedContent} tone={accent.tone} />
                    {status.exfiltrationOpen.length > 0 && (
                        <Leg label="Exfiltration (open)" tools={status.exfiltrationOpen} tone="danger" />
                    )}
                    {status.exfiltrationGated.length > 0 && (
                        <Leg label="Exfiltration (curator-gated)" tools={status.exfiltrationGated} tone="warning" />
                    )}
                </div>
            </Stack>
        </Card>
    );
}
