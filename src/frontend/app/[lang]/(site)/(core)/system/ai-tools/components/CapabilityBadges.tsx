'use client';

/**
 * @fileoverview Renders an AI tool's capability classification as a row of
 * tone-coded badges (side effect, reversibility, spend, sensitivity,
 * untrusted-content, self-curated review). Shared by the Registry and Activity
 * tabs and the MCP Tools tab so the risk class reads consistently everywhere.
 *
 * Each badge explains itself on hover, because words such as "internal" or
 * "untrusted content" name a policy class rather than describe what the tool
 * does, and an admin cannot be expected to know what each one triggers. These
 * badges show what the tool *declares*; the effective approval and unattended
 * gates the governor derives from that declaration are editable in each tool's
 * Registry policy editor (the row's expander).
 */

import type { IAiToolCapability } from '@/types';
import { Badge } from '../../../../../../../components/ui/Badge';
import { Tooltip } from '../../../../../../../components/ui/Tooltip';
import styles from '../page.module.scss';

/** A resolved badge: its label, the tone that signals its risk, and what it means. */
interface ICapabilityBadge {
    label: string;
    tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
    meaning: string;
}

/**
 * Derive the badge set for a capability. Absent capability renders a single
 * "unclassified" badge — matching the governor's read/internal default.
 *
 * @param cap - The tool's capability, or undefined when unclassified.
 * @returns The badges to render, in display order.
 */
function badgesFor(cap?: IAiToolCapability): ICapabilityBadge[] {
    const badges: ICapabilityBadge[] = [];
    // A capability with no declared side effect (absent, or a partial/malformed
    // object) is unclassified — render the single warning badge rather than an
    // empty one from an undefined sideEffect label.
    if (!cap || !cap.sideEffect) {
        badges.push({ label: 'unclassified', tone: 'warning', meaning: 'The tool declares no capability, so it is treated as a read of internal data and cannot be granted over MCP.' });
        return badges;
    }

    if (cap.sideEffect === 'external') {
        badges.push({ label: 'external', tone: 'danger', meaning: 'Acts outside TronRelic, such as posting to a social network or sending a message. Ships switched off and does not run unattended without an admin override.' });
    } else if (cap.sideEffect === 'write') {
        badges.push({ label: 'write', tone: 'warning', meaning: 'Changes data inside TronRelic.' });
    } else {
        badges.push({ label: 'read', tone: 'neutral', meaning: 'Only reads data and changes nothing.' });
    }

    if (cap.reversible === false) {
        badges.push({ label: 'irreversible', tone: 'danger', meaning: 'Its effect cannot be undone, so a call waits for an admin to approve it unless the tool holds its effects for review itself.' });
    }
    if (cap.spendsMoney) {
        badges.push({ label: 'spends money', tone: 'warning', meaning: 'Each call costs money, so calls are counted against a daily cost ceiling.' });
    }
    if (cap.sensitivity === 'secret') {
        badges.push({ label: 'secret', tone: 'danger', meaning: 'Returns private data, such as account details, logs, or stored AI answers. Cannot be granted to mcp-users or Anonymous over MCP.' });
    } else if (cap.sensitivity === 'internal') {
        badges.push({ label: 'internal', tone: 'neutral', meaning: 'Returns data meant for TronRelic users rather than the public. Can be granted to signed-in MCP groups but not to Anonymous.' });
    } else {
        badges.push({ label: 'public', tone: 'success', meaning: 'Returns only data that is public anyway, so it may be granted to Anonymous MCP callers.' });
    }
    if (cap.surfacesUntrustedContent) {
        badges.push({ label: 'untrusted content', tone: 'warning', meaning: 'Its results can contain text written by outsiders, such as transaction memos or fetched web pages. The result is marked as data so the model does not follow instructions hidden in it.' });
    }
    if (cap.forcesCuratorReview) {
        badges.push({ label: 'forces review', tone: 'info', meaning: 'Every effect is held in the curation queue at /system/curation until a person approves it.' });
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
                <Tooltip key={badge.label} content={badge.meaning}>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                </Tooltip>
            ))}
        </span>
    );
}
