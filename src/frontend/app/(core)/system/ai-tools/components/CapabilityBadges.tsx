'use client';

/**
 * @fileoverview Renders an AI tool's capability classification as a row of
 * tone-coded badges (side effect, reversibility, spend, sensitivity,
 * untrusted-content, self-curated review). Shared by the Registry, Activity,
 * and Policy tabs so the risk class reads consistently everywhere. These badges
 * show what the tool *declares*; the effective approval/unattended gates the
 * governor derives from that declaration live on the Policy tab.
 */

import type { IAiToolCapability } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';
import styles from '../page.module.scss';

/** A resolved badge: its label and the tone that signals its risk. */
interface CapabilityBadge {
    label: string;
    tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

/**
 * Derive the badge set for a capability. Absent capability renders a single
 * "unclassified" badge — matching the governor's read/internal default.
 *
 * @param cap - The tool's capability, or undefined when unclassified.
 * @returns The badges to render, in display order.
 */
function badgesFor(cap?: IAiToolCapability): CapabilityBadge[] {
    const badges: CapabilityBadge[] = [];
    // A capability with no declared side effect (absent, or a partial/malformed
    // object) is unclassified — render the single warning badge rather than an
    // empty one from an undefined sideEffect label.
    if (!cap || !cap.sideEffect) {
        badges.push({ label: 'unclassified', tone: 'warning' });
        return badges;
    }

    const sideEffectTone = cap.sideEffect === 'external' ? 'danger' : cap.sideEffect === 'write' ? 'warning' : 'neutral';
    badges.push({ label: cap.sideEffect, tone: sideEffectTone });

    if (cap.reversible === false) {
        badges.push({ label: 'irreversible', tone: 'danger' });
    }
    if (cap.spendsMoney) {
        badges.push({ label: 'spends money', tone: 'warning' });
    }
    if (cap.sensitivity === 'secret') {
        badges.push({ label: 'secret', tone: 'danger' });
    } else if (cap.sensitivity === 'internal') {
        badges.push({ label: 'internal', tone: 'neutral' });
    }
    if (cap.surfacesUntrustedContent) {
        badges.push({ label: 'untrusted content', tone: 'warning' });
    }
    if (cap.forcesCuratorReview) {
        badges.push({ label: 'forces review', tone: 'info' });
    }
    return badges;
}

/**
 * Capability badge row for a single tool.
 *
 * @param props.capability - The tool's capability classification.
 * @returns The badge row.
 */
export function CapabilityBadges({ capability }: { capability?: IAiToolCapability }) {
    return (
        <span className={styles.badges}>
            {badgesFor(capability).map(badge => (
                <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>
            ))}
        </span>
    );
}
