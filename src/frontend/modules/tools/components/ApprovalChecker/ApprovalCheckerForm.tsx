/**
 * @fileoverview The token approval checker's form and results, without page chrome.
 *
 * The checker is served inside a CMS page body as the
 * `tools:approval-checker` widget, and the CMS page supplies the heading and
 * text around it, so this component draws no page header of its own.
 *
 * Scans a TRON wallet for active TRC20 token approvals by querying TronGrid
 * for historical Approval events and checking live allowance values. Displays
 * results in a table with unlimited approval warnings. The endpoint requires a
 * session, so a signed-out visitor sees a sign-in note in place of the form.
 * User-triggered action — loading state is appropriate here.
 */
'use client';

import { useState } from 'react';
import { Shield, ShieldAlert } from 'lucide-react';
// Direct import (not the modules/user barrel) keeps component CSS out of the bundle.
import { useAuthSession } from '../../../user/components/SessionProvider';
import { Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { AddressSelector } from '../../../../components/ui/AddressSelector';
import { isValidTronAddress } from '../../../../lib/tronAddress';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { checkApprovals } from '../../api/client';
import type { IApprovalCheckResult } from '../../types';
import styles from './ApprovalChecker.module.scss';

/** Props for {@link ApprovalCheckerForm}. */
interface IApprovalCheckerFormProps {
    /**
     * Address to start with, taken from the page link's `?address=`, which
     * the address chip menu sends. Anyone can edit a link, so the form uses it
     * only when it is a valid TRON address: an unchecked value would show as
     * the selector's chosen address and arm the Check button with something
     * the backend rejects. Read once, so it never overrides later typing.
     */
    initialAddress?: string;
}

/**
 * Token approval checker form.
 *
 * Users choose a TRON address and receive a list of all active TRC20 token
 * approvals with spender addresses, allowance amounts, and unlimited flags.
 * The address is kept while the visitor is signed out, so the field is ready
 * the moment they sign in.
 *
 * @param props - Component props.
 * @param props.initialAddress - Address the field starts with, if the page link carried a valid one.
 * @returns The sign-in note for a signed-out visitor, or the checker card.
 */
export function ApprovalCheckerForm({ initialAddress = '' }: IApprovalCheckerFormProps) {
    const { isLoggedIn } = useAuthSession();
    // Null rather than '' because AddressSelector only ever hands back a
    // validated address or nothing — there is no partial value to hold.
    const [address, setAddress] = useState<string | null>(() => {
        const trimmed = initialAddress.trim();
        return trimmed && isValidTronAddress(trimmed) ? trimmed : null;
    });
    const [result, setResult] = useState<IApprovalCheckResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation();

    /** Submit the address for approval scanning. */
    const handleCheck = async () => {
        // AddressSelector guarantees a validated address or null, so presence
        // is the whole precondition — no length heuristic needed.
        if (!address) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const data = await checkApprovals(address);
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('tools.approvalChecker.error.failed', 'Failed to check approvals'));
        } finally {
            setLoading(false);
        }
    };

    if (!isLoggedIn) {
        return (
            <div className={styles.container}>
                <Card>
                    <Stack gap="md">
                        <div className={styles.gate_message}>
                            <ShieldAlert size={24} />
                            <p>
                                {t(
                                    'tools.approvalChecker.signInRequired',
                                    'This tool requires you to be signed in. Use the sign-in button in the page header to authenticate, then return here.'
                                )}
                            </p>
                        </div>
                    </Stack>
                </Card>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <Card>
                <Stack gap="md">
                    {/* A span, not a <label>: AddressSelector owns its own
                        input and names it via aria-label, so a `htmlFor`
                        pointing at an id this component does not render
                        would be a dangling association. */}
                    <span className={styles.label}>{t('tools.approvalChecker.addressLabel', 'TRON Wallet Address')}</span>
                    <div className={styles.input_row}>
                        <AddressSelector
                            value={address}
                            onChange={setAddress}
                            aria-label={t('tools.approvalChecker.addressAriaLabel', 'TRON wallet address')}
                        />
                        <Button
                            variant="primary"
                            onClick={handleCheck}
                            disabled={loading || !address}
                            loading={loading}
                        >
                            <Shield size={18} />
                            {t('tools.approvalChecker.check', 'Check')}
                        </Button>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    {result && result.approvals.length === 0 && (
                        <p className={styles.empty}>{t('tools.approvalChecker.empty', 'No active token approvals found for this address.')}</p>
                    )}

                    {result && result.approvals.length > 0 && (
                        <div className={styles.results}>
                            {/* Four columns fit a tablet but not a phone, where the
                                status badge was pushed out of the card, so each
                                approval stacks into a labelled entry below 768px.
                                The token cell names the entry and so has no label. */}
                            <Table variant="compact" stackAt="mobile">
                                <Thead>
                                    <Tr>
                                        <Th>{t('tools.approvalChecker.column.token', 'Token')}</Th>
                                        <Th>{t('tools.approvalChecker.column.spender', 'Spender')}</Th>
                                        <Th>{t('tools.approvalChecker.column.allowance', 'Allowance')}</Th>
                                        <Th width="shrink">{t('tools.approvalChecker.column.status', 'Status')}</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {result.approvals.map((approval, i) => (
                                        <Tr key={`${approval.tokenAddress}-${approval.spenderAddress}-${i}`}>
                                            <Td>
                                                <span className={styles.token_name}>
                                                    {approval.tokenSymbol}
                                                </span>
                                                <span className={styles.token_address}>
                                                    {approval.tokenName}
                                                </span>
                                            </Td>
                                            <Td label={t('tools.approvalChecker.column.spender', 'Spender')}>
                                                <TronAddress address={approval.spenderAddress} />
                                            </Td>
                                            <Td label={t('tools.approvalChecker.column.allowance', 'Allowance')}>{approval.allowanceFormatted}</Td>
                                            <Td label={t('tools.approvalChecker.column.status', 'Status')}>
                                                {approval.isUnlimited ? (
                                                    <Badge tone="danger" size="sm">{t('tools.approvalChecker.unlimited', 'Unlimited')}</Badge>
                                                ) : (
                                                    <Badge tone="success" size="sm">{t('tools.approvalChecker.limited', 'Limited')}</Badge>
                                                )}
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>

                            {result.truncated && (
                                <p className={styles.truncated}>
                                    {t('tools.approvalChecker.truncated', 'Results truncated. Only the first {count} approval pairs are shown.', { count: 20 })}
                                </p>
                            )}
                        </div>
                    )}
                </Stack>
            </Card>
        </div>
    );
}
