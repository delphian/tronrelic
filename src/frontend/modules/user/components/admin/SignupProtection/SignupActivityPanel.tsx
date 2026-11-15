'use client';

/**
 * @fileoverview The report half of the Sign-ups tab of `/system/users`: how
 * many sign-ups each protection refused, and which email domains new accounts
 * and refusals came from over the last week.
 *
 * The domain list is how an admin spots a farm. A disposable domain with
 * several new accounts in a day stands out, and its Block button adds a rule
 * in one step after a confirmation.
 */

import { useCallback } from 'react';
import { Ban } from 'lucide-react';
import type { IEmailDomainActivity, ISignupProtectionReport } from '@/types';
import { SIGNUP_REFUSAL_REASONS } from '@/types';
import { Panel } from '../../../../../components/ui/Panel';
import { Button } from '../../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ConfirmDialog } from '../../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { saveDomainRule } from '../../../api/sign-up-protection.api';
import { DomainRuleBadge } from './DomainRuleBadge';

/** Plain description of each refusal reason code. */
const REASON_LABELS: Record<string, string> = {
    [SIGNUP_REFUSAL_REASONS.domainBlocked]: 'Email domain blocked',
    [SIGNUP_REFUSAL_REASONS.domainSlowed]: 'Email domain over its code budget',
    [SIGNUP_REFUSAL_REASONS.signupsPaused]: 'Sign-up cap enforced'
};

/** Props for the activity panels. */
interface ISignupActivityPanelProps {
    /** The latest report. */
    report: ISignupProtectionReport;

    /** Receives the report the backend answers a change with. */
    onReport: (next: ISignupProtectionReport) => void;
}

/**
 * Refusal counts and the recent sign-ups by email domain.
 *
 * @param props - The report and its update callback.
 * @returns Two panels.
 */
export function SignupActivityPanel({ report, onReport }: ISignupActivityPanelProps) {
    const { open, close } = useModal();
    const { push } = useToast();

    /** Ask for confirmation, then add a `block` rule for one domain. */
    const handleBlock = useCallback((row: IEmailDomainActivity) => {
        const modalId = open({
            title: 'Block email domain',
            content: (
                <ConfirmDialog
                    label={row.domain}
                    confirmLabel="Block domain"
                    message={`New addresses on ${row.domain} and its subdomains will be refused. Existing accounts are not affected; delete them on the Users tab if they belong to a farm. Continue?`}
                    onConfirm={
                        async () => {
                            try {
                                onReport(await saveDomainRule(row.domain, { action: 'block', maxCodes: null, budgetWindow: null, note: 'Blocked from the recent sign-ups report' }));
                                push({ tone: 'success', title: `${row.domain} blocked` });
                            } catch (error) {
                                push({ tone: 'danger', title: 'Could not block the domain', description: error instanceof Error ? error.message : String(error) });
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

    return (
        <>
            <Panel title="Refused sign-ups" meta="By the sign-up protections">
                <Table variant="compact" flush>
                    <Thead>
                        <Tr>
                            <Th>Reason</Th>
                            <Th numeric>Last 24 hours</Th>
                            <Th numeric>Last 7 days</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {report.refusals.map(row => (
                            <Tr key={row.reason}>
                                <Td>{REASON_LABELS[row.reason] ?? row.reason}</Td>
                                <Td numeric>{row.last24Hours.toLocaleString('en-US')}</Td>
                                <Td numeric>{row.last7Days.toLocaleString('en-US')}</Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            </Panel>

            <Panel title="Recent sign-ups by email domain" meta="Last 7 days, busiest first">
                {report.domainActivity.length === 0 ? (
                    <p className="text-muted">No new accounts or refused sign-ups in the last 7 days.</p>
                ) : (
                    <Table variant="compact" flush stackAt="mobile">
                        <Thead>
                            <Tr>
                                <Th>Domain</Th>
                                <Th numeric>New accounts</Th>
                                <Th numeric>Refused</Th>
                                <Th>Rule</Th>
                                <Th width="shrink" aria-label="Actions" />
                            </Tr>
                        </Thead>
                        <Tbody>
                            {report.domainActivity.map(row => (
                                <Tr key={row.domain}>
                                    {/* No label: the domain heads a stacked entry. */}
                                    <Td><code>{row.domain}</code></Td>
                                    <Td label="New accounts" numeric>{row.newAccounts.toLocaleString('en-US')}</Td>
                                    <Td label="Refused" numeric>{row.refusals.toLocaleString('en-US')}</Td>
                                    <Td label="Rule">{row.ruleAction ? <DomainRuleBadge action={row.ruleAction} /> : <span className="text-muted">None</span>}</Td>
                                    {/* No label: the Block button is self-describing. */}
                                    <Td>
                                        {row.ruleAction !== 'block' && (
                                            <Button size="xs" variant="ghost" onClick={() => handleBlock(row)} icon={<Ban size={14} />} aria-label={`Block ${row.domain}`}>
                                                Block
                                            </Button>
                                        )}
                                    </Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                )}
            </Panel>
        </>
    );
}
