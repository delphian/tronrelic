'use client';

/**
 * @file RunTrifectaBadge.tsx
 *
 * Compact per-run lethal-trifecta indicator for the saved-prompt editor. Where
 * TrifectaPanel is the page-level banner over the whole enabled set, this badge
 * reflects the trifecta scoped to one prompt's selected tool allowlist, so the
 * operator sees in real time whether narrowing the selection breaks the chain.
 *
 * It reads `status.severity` — `safe` (a leg is absent), `supervised` (all three
 * present but every egress is curator-gated), `lethal` (all three with an open
 * channel) — and names the contributing legs when not safe so the operator knows
 * which tool to drop. The scoped verdict is computed server-side (it depends on
 * live curation/policy state and provider server-tools), so this component only
 * renders what the preview endpoint returns.
 */

import { ShieldCheck, ShieldAlert, AlertTriangle, Loader2 } from 'lucide-react';
import type { ITrifectaStatus, TrifectaSeverity } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';
import styles from './RunTrifectaBadge.module.scss';

interface RunTrifectaBadgeProps {
    /** The scoped trifecta status, or null before the first preview resolves. */
    status: ITrifectaStatus | null;
    /** Whether a preview request is in flight (drives the pending state). */
    loading: boolean;
}

/** Badge tone for a leg's contributing-tool chips. */
type LegTone = 'warning' | 'danger';

/** Presentation per severity: badge tone, icon, and headline. */
const SEVERITY_PRESENTATION: Record<TrifectaSeverity, {
    tone: 'success' | 'warning' | 'danger';
    Icon: typeof ShieldCheck;
    label: string;
}> = {
    safe: { tone: 'success', Icon: ShieldCheck, label: 'No trifecta' },
    supervised: { tone: 'warning', Icon: ShieldAlert, label: 'Trifecta — curator-gated' },
    lethal: { tone: 'danger', Icon: AlertTriangle, label: 'Lethal trifecta' }
};

/**
 * One trifecta leg line: a label plus the tool/variable names contributing it.
 *
 * @param props.label - The leg name.
 * @param props.names - Contributing tool or variable names.
 * @param props.tone - Chip tone matching the leg's severity.
 * @returns The leg line, or null when the leg is empty.
 */
function LegLine({ label, names, tone }: { label: string; names: string[]; tone: LegTone }) {
    if (names.length === 0) {
        return null;
    }
    return (
        <div className={styles.leg}>
            <span className={styles.leg_label}>{label}</span>
            <span className={styles.leg_names}>
                {names.map((name, index) => <Badge key={`${name}-${index}`} tone={tone}>{name}</Badge>)}
            </span>
        </div>
    );
}

/**
 * Render the scoped trifecta badge and, when a trifecta is present, the
 * contributing legs. Shows a pending line until the first preview resolves.
 *
 * @param props.status - The scoped trifecta status (null before first load).
 * @param props.loading - Whether a preview request is in flight.
 * @returns The badge, a pending line, or null when nothing is known yet.
 */
export function RunTrifectaBadge({ status, loading }: RunTrifectaBadgeProps) {
    if (!status) {
        return loading
            ? (
                <span className={styles.pending}>
                    <Loader2 size={12} className={styles.spin} /> Checking tool combination…
                </span>
            )
            : null;
    }

    const { tone, Icon, label } = SEVERITY_PRESENTATION[status.severity];
    const legTone: LegTone = status.severity === 'lethal' ? 'danger' : 'warning';

    return (
        <div className={styles.wrap}>
            <Badge tone={tone} className={styles.badge}>
                <Icon size={12} /> {label}
            </Badge>
            {status.severity !== 'safe' && (
                <div className={styles.legs}>
                    <LegLine label="Private data" names={[...status.privateData, ...status.privateDataVariables]} tone={legTone} />
                    <LegLine label="Untrusted content" names={status.untrustedContent} tone={legTone} />
                    <LegLine label="Egress (open)" names={status.exfiltrationOpen} tone="danger" />
                    <LegLine label="Egress (curator-gated)" names={status.exfiltrationGated} tone="warning" />
                </div>
            )}
        </div>
    );
}
