'use client';

/**
 * @fileoverview The email domain rules on the Sign-ups tab of `/system/users`:
 * a form that adds or replaces a rule, and the table of stored rules.
 *
 * A rule covers its domain and every subdomain, and applies only to addresses
 * that do not have an account yet, so a rule can never lock out an existing
 * user. Saving a rule for a domain that already has one replaces it, which is
 * how the Edit action works.
 */

import { useCallback, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { DomainBudgetWindow, EmailDomainRuleAction, IEmailDomainRule, ISignupProtectionReport } from '@/types';
import { SIGNUP_PROTECTION_LIMITS, normalizeEmailDomain } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Panel } from '../../../../../components/ui/Panel';
import { Button } from '../../../../../components/ui/Button';
import { IconButton } from '../../../../../components/ui/IconButton';
import { Field } from '../../../../../components/ui/Field';
import { Input } from '../../../../../components/ui/Input';
import { Select } from '../../../../../components/ui/Select';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { ConfirmDialog } from '../../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { removeDomainRule, saveDomainRule } from '../../../api/sign-up-protection.api';
import { DomainRuleBadge } from './DomainRuleBadge';
import styles from './SignupProtectionTab.module.scss';

/** What each action does, shown as the action field's hint. */
const ACTION_HINTS: Record<EmailDomainRuleAction, string> = {
    block: 'Block. No sign-in code is sent and no account is created for a new address on this domain, by any sign-in method.',
    slow: 'Slow. Every new address on this domain shares one budget of sign-in codes per hour or per day. Use it for a domain real people also use.'
};

/** What each budget window means, shown as the window field's hint. */
const WINDOW_HINTS: Record<DomainBudgetWindow, string> = {
    hour: 'Resets an hour after the first code.',
    day: 'Resets 24 hours after the first code.'
};

/**
 * Describe what is wrong with the typed domain.
 *
 * @param value - The domain field's text.
 * @returns A message, or undefined when the field is empty or valid.
 */
function domainError(value: string): string | undefined {
    return value.trim() === '' || normalizeEmailDomain(value) ? undefined : 'Enter a domain such as example.com.';
}

/**
 * Describe what is wrong with the typed code budget.
 *
 * @param value - The budget field's text.
 * @returns A message, or undefined when it is valid.
 */
function budgetError(value: string): string | undefined {
    const parsed = Number(value);
    const valid = /^\d+$/.test(value.trim()) && parsed >= SIGNUP_PROTECTION_LIMITS.minCodes && parsed <= SIGNUP_PROTECTION_LIMITS.maxCodes;
    return valid ? undefined : `Enter a whole number from ${SIGNUP_PROTECTION_LIMITS.minCodes} to ${SIGNUP_PROTECTION_LIMITS.maxCodes.toLocaleString('en-US')}.`;
}

/** Props for the domain rules panel. */
interface IDomainRulesPanelProps {
    /** The latest report; its settings hold the rules. */
    report: ISignupProtectionReport;

    /** Receives the report the backend answers a change with. */
    onReport: (next: ISignupProtectionReport) => void;
}

/**
 * The domain rule form and the table of stored rules.
 *
 * @param props - The report and its update callback.
 * @returns The panel.
 */
export function DomainRulesPanel({ report, onReport }: IDomainRulesPanelProps) {
    const [domain, setDomain] = useState('');
    const [action, setAction] = useState<EmailDomainRuleAction>('block');
    const [budget, setBudget] = useState(String(SIGNUP_PROTECTION_LIMITS.defaultCodes));
    const [budgetWindow, setBudgetWindow] = useState<DomainBudgetWindow>(SIGNUP_PROTECTION_LIMITS.defaultBudgetWindow);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const { open, close } = useModal();
    const { push } = useToast();
    const rules = report.config.domainRules;

    /** Put a stored rule into the form, so saving replaces it. */
    const handleEdit = useCallback((rule: IEmailDomainRule) => {
        setDomain(rule.domain);
        setAction(rule.action);
        setBudget(String(rule.maxCodes ?? SIGNUP_PROTECTION_LIMITS.defaultCodes));
        setBudgetWindow(rule.budgetWindow ?? SIGNUP_PROTECTION_LIMITS.defaultBudgetWindow);
        setNote(rule.note);
    }, []);

    /** Save the rule in the form, then clear the form for the next one. */
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            onReport(await saveDomainRule(domain.trim(), {
                action,
                maxCodes: action === 'slow' ? Number(budget) : null,
                budgetWindow: action === 'slow' ? budgetWindow : null,
                note: note.trim()
            }));
            push({ tone: 'success', title: `Rule saved for ${normalizeEmailDomain(domain) ?? domain}` });
            setDomain('');
            setNote('');
        } catch (error) {
            push({ tone: 'danger', title: 'Could not save the rule', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setSaving(false);
        }
    }, [action, budget, budgetWindow, domain, note, onReport, push]);

    /** Ask for confirmation, then remove a stored rule. */
    const handleRemove = useCallback((rule: IEmailDomainRule) => {
        const modalId = open({
            title: 'Remove email domain rule',
            content: (
                <ConfirmDialog
                    label={rule.domain}
                    confirmLabel="Remove rule"
                    message={`New addresses on ${rule.domain} will be able to sign up normally again. Continue?`}
                    onConfirm={
                        async () => {
                            try {
                                onReport(await removeDomainRule(rule.domain));
                                push({ tone: 'success', title: `Rule removed for ${rule.domain}` });
                            } catch (error) {
                                push({ tone: 'danger', title: 'Could not remove the rule', description: error instanceof Error ? error.message : String(error) });
                            } finally {
                                close(modalId);
                            }
                        }
                    }
                    onCancel={() => close(modalId)}
                />
            )
        });
    }, [close, onReport, open, push]);

    const typedDomainError = domainError(domain);
    const typedBudgetError = action === 'slow' ? budgetError(budget) : undefined;
    const noteTooLong = note.trim().length > SIGNUP_PROTECTION_LIMITS.maxNoteLength;
    const canSave = domain.trim() !== '' && !typedDomainError && !typedBudgetError && !noteTooLong;

    return (
        <Panel title="Email domain rules" meta={`${rules.length} of ${SIGNUP_PROTECTION_LIMITS.maxDomainRules} · new addresses only`}>
            <Stack gap="md">
                <div className={styles.form_container}>
                    <div className={`${styles.form_grid} ${styles.form_grid__rule}`}>
                        <Field label="Domain" htmlFor="signup-rule-domain" error={typedDomainError} hint="Covers subdomains too.">
                            <Input
                                id="signup-rule-domain"
                                size="sm"
                                value={domain}
                                placeholder="example.com"
                                invalid={typedDomainError !== undefined}
                                onChange={event => setDomain(event.target.value)}
                            />
                        </Field>
                        <Field label="Action" htmlFor="signup-rule-action" hint={ACTION_HINTS[action]}>
                            <Select id="signup-rule-action" size="sm" value={action} onChange={event => setAction(event.target.value as EmailDomainRuleAction)}>
                                <option value="block">Block</option>
                                <option value="slow">Slow</option>
                            </Select>
                        </Field>
                        <Field label="Codes" htmlFor="signup-rule-budget" error={typedBudgetError} hint="Shared by the whole domain.">
                            <Input
                                id="signup-rule-budget"
                                size="sm"
                                inputMode="numeric"
                                value={budget}
                                disabled={action !== 'slow'}
                                invalid={typedBudgetError !== undefined}
                                onChange={event => setBudget(event.target.value)}
                            />
                        </Field>
                        <Field label="Per" htmlFor="signup-rule-window" hint={WINDOW_HINTS[budgetWindow]}>
                            <Select
                                id="signup-rule-window"
                                size="sm"
                                value={budgetWindow}
                                disabled={action !== 'slow'}
                                onChange={event => setBudgetWindow(event.target.value as DomainBudgetWindow)}
                            >
                                <option value="hour">Hour</option>
                                <option value="day">Day (24 hours)</option>
                            </Select>
                        </Field>
                        <Field
                            label="Note"
                            htmlFor="signup-rule-note"
                            error={noteTooLong ? `Keep the note to ${SIGNUP_PROTECTION_LIMITS.maxNoteLength} characters.` : undefined}
                            hint="Why the rule exists."
                        >
                            <Input
                                id="signup-rule-note"
                                size="sm"
                                value={note}
                                invalid={noteTooLong}
                                onChange={event => setNote(event.target.value)}
                            />
                        </Field>
                    </div>
                </div>
                <div className={styles.form_actions}>
                    <Button size="sm" variant="primary" loading={saving} disabled={!canSave} onClick={() => void handleSave()} icon={<Plus size={16} />}>
                        Save rule
                    </Button>
                </div>

                {rules.length === 0 ? (
                    <p className="text-muted">No rules yet. Domains that new accounts come from are listed under Recent sign-ups below.</p>
                ) : (
                    <Table variant="compact" flush stackAt="mobile">
                        <Thead>
                            <Tr>
                                <Th>Domain</Th>
                                <Th>Rule</Th>
                                <Th>Note</Th>
                                <Th>Changed</Th>
                                <Th width="shrink" aria-label="Actions" />
                            </Tr>
                        </Thead>
                        <Tbody>
                            {rules.map(rule => (
                                <Tr key={rule.domain}>
                                    {/* No label: the domain heads a stacked entry. */}
                                    <Td><code>{rule.domain}</code></Td>
                                    <Td label="Rule"><DomainRuleBadge action={rule.action} maxCodes={rule.maxCodes} budgetWindow={rule.budgetWindow} /></Td>
                                    <Td label="Note" stackSpan={2}>{rule.note || <span className="text-muted">—</span>}</Td>
                                    <Td label="Changed"><ClientTime date={rule.updatedAt} format="date" /></Td>
                                    <Td label="Actions">
                                        <div className={styles.row_actions}>
                                            <IconButton size="sm" aria-label={`Edit the rule for ${rule.domain}`} onClick={() => handleEdit(rule)}>
                                                <Pencil size={14} aria-hidden="true" />
                                            </IconButton>
                                            <IconButton size="sm" variant="danger" aria-label={`Remove the rule for ${rule.domain}`} onClick={() => handleRemove(rule)}>
                                                <Trash2 size={14} aria-hidden="true" />
                                            </IconButton>
                                        </div>
                                    </Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                )}
            </Stack>
        </Panel>
    );
}
