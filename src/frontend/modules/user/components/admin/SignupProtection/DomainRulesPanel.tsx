'use client';

/**
 * @fileoverview The email domain rules on the Sign-ups tab of `/system/users`:
 * a form that adds or replaces a rule, and the table of stored rules.
 *
 * A rule covers its domain and every subdomain, and applies only to addresses
 * that do not have an account yet, so a rule can never lock out an existing
 * user. Saving a rule for a domain that already has one replaces it, which is
 * how the Edit action works.
 *
 * The form stays closed until the admin asks for it with Add rule in the
 * panel header, or with Edit on a row, so the rules come first. Its fields and
 * Save button share one row, and the code budget fields appear only for a
 * Slow rule, the one action that uses them.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { DomainBudgetWindow, EmailDomainRuleAction, IEmailDomainRule, ISignupProtectionReport } from '@/types';
import { SIGNUP_PROTECTION_LIMITS, normalizeEmailDomain } from '@/types';
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

/** What each action does, shown under the form as the action field's description. */
const ACTION_HINTS: Record<EmailDomainRuleAction, string> = {
    block: 'Block: no sign-in code is sent and no account is created for a new address on this domain or its subdomains, by any sign-in method.',
    slow: 'Slow: every new address on this domain and its subdomains shares one budget of sign-in codes. Use it for a domain real people also use.'
};

/** When a Slow rule's budget resets, added to the action's description. */
const WINDOW_HINTS: Record<DomainBudgetWindow, string> = {
    hour: 'The budget resets an hour after the first code.',
    day: 'The budget resets 24 hours after the first code.'
};

/** Id of the add-rule form, which the Add rule button names with `aria-controls`. */
const FORM_ID = 'signup-rule-form';

/** Id of the rule description, which the action field points at with `aria-describedby`. */
const ACTION_HELP_ID = 'signup-rule-action-help';

/** Id of the domain field, which takes focus when the form opens. */
const DOMAIN_INPUT_ID = 'signup-rule-domain';

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
    const [formOpen, setFormOpen] = useState(false);
    const [focusRequest, setFocusRequest] = useState(0);
    const { open, close } = useModal();
    const { push } = useToast();
    const rules = report.config.domainRules;

    const typedDomainError = domainError(domain);
    const typedBudgetError = action === 'slow' ? budgetError(budget) : undefined;
    const noteTooLong = note.trim().length > SIGNUP_PROTECTION_LIMITS.maxNoteLength;
    const canSave = domain.trim() !== '' && !typedDomainError && !typedBudgetError && !noteTooLong;

    /**
     * Move focus to the domain field once the form has opened. Focusing also
     * scrolls the form into view, which matters after Edit on a rule far down
     * the table.
     */
    useEffect(() => {
        if (focusRequest > 0) {
            document.getElementById(DOMAIN_INPUT_ID)?.focus();
        }
    }, [focusRequest]);

    /** Open or close the form from the panel header, focusing it when it opens. */
    const handleToggleForm = useCallback(() => {
        if (!formOpen) {
            setFocusRequest(current => current + 1);
        }
        setFormOpen(!formOpen);
    }, [formOpen]);

    /** Open the form with a stored rule in it, so saving replaces that rule. */
    const handleEdit = useCallback((rule: IEmailDomainRule) => {
        setDomain(rule.domain);
        setAction(rule.action);
        setBudget(String(rule.maxCodes ?? SIGNUP_PROTECTION_LIMITS.defaultCodes));
        setBudgetWindow(rule.budgetWindow ?? SIGNUP_PROTECTION_LIMITS.defaultBudgetWindow);
        setNote(rule.note);
        setFormOpen(true);
        setFocusRequest(current => current + 1);
    }, []);

    /**
     * Save the rule in the form, then clear and close the form. A submission
     * with a field still invalid sends nothing.
     *
     * @param event - The form submission, whose default page reload is stopped.
     */
    const handleSave = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        if (canSave) {
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
                setFormOpen(false);
            } catch (error) {
                push({ tone: 'danger', title: 'Could not save the rule', description: error instanceof Error ? error.message : String(error) });
            } finally {
                setSaving(false);
            }
        }
    }, [action, budget, budgetWindow, canSave, domain, note, onReport, push]);

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

    const isSlow = action === 'slow';

    return (
        <Panel
            title="Email domain rules"
            meta={`${rules.length} of ${SIGNUP_PROTECTION_LIMITS.maxDomainRules} · new addresses only`}
            actions={(
                <Button
                    variant="secondary"
                    icon={<Plus size={16} />}
                    aria-expanded={formOpen}
                    aria-controls={FORM_ID}
                    onClick={handleToggleForm}
                >
                    Add rule
                </Button>
            )}
        >
            {formOpen && (
                <div className={`${styles.form_container} ${styles.form_container__divided}`}>
                    <form
                        id={FORM_ID}
                        className={`${styles.form_row} ${isSlow ? styles.form_row__rule_slow : styles.form_row__rule}`}
                        aria-label="Add or replace an email domain rule"
                        onSubmit={event => void handleSave(event)}
                    >
                        <Field label="Domain" error={typedDomainError} className={styles.form_field}>
                            <Input
                                id={DOMAIN_INPUT_ID}
                                value={domain}
                                placeholder="example.com"
                                invalid={typedDomainError !== undefined}
                                onChange={event => setDomain(event.target.value)}
                            />
                        </Field>
                        <Field label="Action" className={styles.form_field}>
                            <Select
                                id="signup-rule-action"
                                value={action}
                                aria-describedby={ACTION_HELP_ID}
                                onChange={event => setAction(event.target.value as EmailDomainRuleAction)}
                            >
                                <option value="block">Block</option>
                                <option value="slow">Slow</option>
                            </Select>
                        </Field>
                        {isSlow && (
                            <Field label="Codes" error={typedBudgetError} className={styles.form_field}>
                                <Input
                                    id="signup-rule-budget"
                                    inputMode="numeric"
                                    value={budget}
                                    invalid={typedBudgetError !== undefined}
                                    onChange={event => setBudget(event.target.value)}
                                />
                            </Field>
                        )}
                        {isSlow && (
                            <Field label="Per" className={styles.form_field}>
                                <Select
                                    id="signup-rule-window"
                                    value={budgetWindow}
                                    onChange={event => setBudgetWindow(event.target.value as DomainBudgetWindow)}
                                >
                                    <option value="hour">Hour</option>
                                    <option value="day">Day (24 hours)</option>
                                </Select>
                            </Field>
                        )}
                        <Field
                            label="Note"
                            error={noteTooLong ? `Keep the note to ${SIGNUP_PROTECTION_LIMITS.maxNoteLength} characters.` : undefined}
                            className={styles.form_field}
                        >
                            <Input
                                id="signup-rule-note"
                                value={note}
                                placeholder="Why the rule exists"
                                invalid={noteTooLong}
                                onChange={event => setNote(event.target.value)}
                            />
                        </Field>
                        <p id={ACTION_HELP_ID} className={styles.form_help}>
                            {isSlow ? `${ACTION_HINTS.slow} ${WINDOW_HINTS[budgetWindow]}` : ACTION_HINTS.block}
                        </p>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={saving}
                            disabled={!canSave}
                            icon={<Plus size={16} />}
                            className={styles.form_submit}
                        >
                            Save rule
                        </Button>
                    </form>
                </div>
            )}

            {rules.length === 0 ? (
                <p className="text-muted">No rules yet. Domains that new accounts come from are listed under Recent sign-ups below.</p>
            ) : (
                <Table variant="compact" flush stackAt="mobile">
                    <Thead>
                        <Tr>
                            <Th>Domain</Th>
                            <Th>Rule</Th>
                            <Th>Note</Th>
                            <Th width="shrink">Changed</Th>
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
                                {/* No label: stacked, the icons close the entry. */}
                                <Td>
                                    <div className={styles.row_actions}>
                                        <IconButton variant="primary" title="Edit" aria-label={`Edit the rule for ${rule.domain}`} onClick={() => handleEdit(rule)}>
                                            <Pencil size={16} aria-hidden="true" />
                                        </IconButton>
                                        <IconButton variant="danger" title="Remove" aria-label={`Remove the rule for ${rule.domain}`} onClick={() => handleRemove(rule)}>
                                            <Trash2 size={16} aria-hidden="true" />
                                        </IconButton>
                                    </div>
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </Panel>
    );
}
