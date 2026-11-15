/**
 * @fileoverview The badge naming an email domain rule's action, shared by the
 * rules table and the recent sign-ups table so both describe a rule the same
 * way.
 */

import type { EmailDomainRuleAction } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';

/** Props for the rule badge. */
interface IDomainRuleBadgeProps {
    /** The rule's action. */
    action: EmailDomainRuleAction;

    /** The rule's shared hourly code budget, shown for a `slow` rule. */
    maxCodesPerHour?: number | null;
}

/**
 * Show a rule's action: red for `block`, amber for `slow` with its budget.
 *
 * @param props - The action and, for `slow`, the budget.
 * @returns The badge.
 */
export function DomainRuleBadge({ action, maxCodesPerHour }: IDomainRuleBadgeProps) {
    const label = action === 'block'
        ? 'Blocked'
        : `Slowed${maxCodesPerHour ? ` · ${maxCodesPerHour.toLocaleString('en-US')}/hour` : ''}`;
    return (
        <Badge tone={action === 'block' ? 'danger' : 'warning'} size="sm">
            {label}
        </Badge>
    );
}
