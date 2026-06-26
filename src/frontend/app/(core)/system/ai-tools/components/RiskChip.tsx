'use client';

/**
 * @fileoverview Collapses a tool's full capability declaration into the single
 * dominant risk class shown in the registry list — the one signal an admin
 * triages by. The detailed multi-badge breakdown stays in the slide-over
 * (CapabilityBadges); the list needs one scannable chip, sorted dangerous-first.
 *
 * Irreversibility outranks side effect: an external-but-irreversible tool reads
 * as "destructive" (danger tone + lock glyph) because that is the property an
 * auditor must catch first, and the lock distinguishes it from a reversible
 * external tool that shares the danger tone. Read/write below it map cool→warm;
 * an unclassified tool is flagged warning so the missing declaration is visible
 * rather than silently treated as safe. This module also exports the rank and
 * presentation maps so the registry sorts and filters off the same definition.
 */

import { Lock } from 'lucide-react';
import type { IAiToolCapability } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';

/** The single dominant risk class derived from a capability. */
export type RiskClass = 'destructive' | 'external' | 'write' | 'unclassified' | 'read';

/**
 * Reduce a capability to its dominant risk class. Irreversibility wins outright;
 * otherwise the declared side effect is the class. An absent or side-effect-less
 * capability is `unclassified` — the governor's read/internal default, surfaced
 * so the missing declaration shows.
 *
 * @param capability - The tool's capability, or undefined when unclassified.
 * @returns The dominant risk class.
 */
export function riskClassOf(capability?: IAiToolCapability): RiskClass {
    let result: RiskClass;
    if (!capability || !capability.sideEffect) {
        result = 'unclassified';
    } else if (capability.reversible === false) {
        result = 'destructive';
    } else {
        result = capability.sideEffect;
    }
    return result;
}

/**
 * Sort weight per class, dangerous-first, so the registry's default ordering
 * meets the high-stakes tools at the top of an audit sweep.
 */
const RISK_RANK: Record<RiskClass, number> = {
    destructive: 4,
    external: 3,
    write: 2,
    unclassified: 1,
    read: 0
};

/**
 * Numeric risk weight for a capability, for the registry's default sort.
 *
 * @param capability - The tool's capability, or undefined when unclassified.
 * @returns The class's sort weight (higher is more dangerous).
 */
export function riskRankOf(capability?: IAiToolCapability): number {
    return RISK_RANK[riskClassOf(capability)];
}

/** Tone and label per class, shared by the list chip and the filter pills. */
export const RISK_PRESENTATION: Record<RiskClass, { tone: 'neutral' | 'warning' | 'danger'; label: string }> = {
    destructive: { tone: 'danger', label: 'destructive' },
    external: { tone: 'danger', label: 'external' },
    write: { tone: 'warning', label: 'write' },
    unclassified: { tone: 'warning', label: 'unclassified' },
    read: { tone: 'neutral', label: 'read' }
};

/** Display order for the filter pills — dangerous-first, unclassified last. */
export const RISK_CLASS_ORDER: RiskClass[] = ['destructive', 'external', 'write', 'read', 'unclassified'];

/**
 * The dominant-risk chip for one tool's registry row.
 *
 * @param props.capability - The tool's capability classification.
 * @returns A single tone-coded badge, with a lock glyph on the destructive class.
 */
export function RiskChip({ capability }: { capability?: IAiToolCapability }) {
    const riskClass = riskClassOf(capability);
    const { tone, label } = RISK_PRESENTATION[riskClass];
    return (
        <Badge tone={tone}>
            {riskClass === 'destructive' && <Lock size={12} aria-hidden="true" />}
            {label}
        </Badge>
    );
}
