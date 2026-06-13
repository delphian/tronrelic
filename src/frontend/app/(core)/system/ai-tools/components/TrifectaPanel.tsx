'use client';

/**
 * @fileoverview Operator banner for the lethal-trifecta check. When the enabled
 * tool set co-presents a secret-data reader, an untrusted-content source, and an
 * external exfiltration channel, injected text can read a secret and send it out
 * in one turn. This surfaces that dangerous co-presence and names the
 * contributing tools so an operator can break the chain by disabling one leg.
 */

import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { ITrifectaStatus } from '@/types';
import { Card } from '../../../../../components/ui/Card';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack } from '../../../../../components/layout';
import styles from '../page.module.scss';

/** One trifecta leg: its label and the enabled tools that contribute it. */
function Leg({ label, tools }: { label: string; tools: string[] }) {
    return (
        <div>
            <div className={styles.trifecta_leg_label}>{label}</div>
            <span className={styles.badges}>
                {tools.length === 0
                    ? <span className="text-subtle">none</span>
                    : tools.map(name => <Badge key={name} tone="danger">{name}</Badge>)}
            </span>
        </div>
    );
}

/**
 * Render the trifecta banner. Shows a danger card with the three legs when the
 * trifecta is present, and a compact reassurance line otherwise.
 *
 * @param props.status - The current trifecta status over the enabled set.
 * @returns The banner.
 */
export function TrifectaPanel({ status }: { status: ITrifectaStatus }) {
    if (!status.present) {
        return (
            <div className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)', fontSize: 'var(--font-size-body-sm)' }}>
                <ShieldCheck size={16} style={{ color: 'var(--color-success)' }} />
                No lethal trifecta — the enabled set does not combine private-data, untrusted-content, and exfiltration tools.
            </div>
        );
    }

    return (
        <Card tone="accent" style={{ borderColor: 'var(--color-danger-alpha-50)' }}>
            <Stack gap="sm">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
                    <AlertTriangle size={18} style={{ color: 'var(--color-danger)' }} />
                    <strong style={{ color: 'var(--color-danger-text)' }}>Lethal trifecta present</strong>
                </div>
                <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                    The enabled tools combine all three legs, so prompt-injected text could read a secret and exfiltrate it in one turn.
                    Disable one leg below to break the chain.
                </p>
                <div className={styles.trifecta_legs}>
                    <Leg label="Private data" tools={status.privateData} />
                    <Leg label="Untrusted content" tools={status.untrustedContent} />
                    <Leg label="Exfiltration" tools={status.exfiltration} />
                </div>
            </Stack>
        </Card>
    );
}
