/**
 * @fileoverview The badge naming an email domain rule's action, shared by the
 * rules table and the recent sign-ups table so both describe a rule the same
 * way.
 */

import type { DomainBudgetWindow, EmailDomainRuleAction } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';

/** How each budget window is written after the slash, as in `3/day`. */
const WINDOW_LABELS: Record<DomainBudgetWindow, string> = {
    hour: 'hour',
    day: 'day'
};

/** Props for the rule badge. */
interface IDomainRuleBadgeProps {
    /** The rule's action. */
    action: EmailDomainRuleAction;

    /** The rule's shared code budget, shown for a `slow` rule. */
    maxCodes?: number | null;

    /** The span the budget is counted over; an hour when absent. */
    budgetWindow?: DomainBudgetWindow | null;
}

/**
 * Show a rule's action: red for `block`, amber for `slow` with its budget,
 * such as `Slowed · 3/hour` or `Slowed · 20/day`.
 *
 * @param props - The action and, for `slow`, the budget and its window.
 * @returns The badge.
 */
export function DomainRuleBadge({ action, maxCodes, budgetWindow }: IDomainRuleBadgeProps) {
    const label = action === 'block'
        ? 'Blocked'
        : `Slowed${maxCodes ? ` · ${maxCodes.toLocaleString('en-US')}/${WINDOW_LABELS[budgetWindow ?? 'hour']}` : ''}`;
    return (
        <Badge tone={action === 'block' ? 'danger' : 'warning'} size="sm">
            {label}
        </Badge>
    );
}
