/**
 * @fileoverview Token approval checker tool page.
 *
 * Scans a TRON wallet for active TRC20 token approvals by querying TronGrid
 * for historical Approval events and checking live allowance values. Displays
 * results in a table with unlimited approval warnings.
 * User-triggered action — loading state is appropriate here.
 */
'use client';

import { useState } from 'react';
import { Shield, ShieldAlert } from 'lucide-react';
import { useAppSelector } from '../../../../store/hooks';
import { selectHasVerifiedWallet } from '../../../user';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { checkApprovals } from '../../api/client';
import type { IApprovalCheckResult } from '../../types';
import styles from './ApprovalChecker.module.scss';

/**
 * Token approval checker tool.
 *
 * Users paste a TRON address and receive a list of all active TRC20 token
 * approvals with spender addresses, allowance amounts, and unlimited flags.
 * No SSR data needed — purely interactive.
 */
export function ApprovalChecker() {
    const hasVerifiedWallet = useAppSelector(selectHasVerifiedWallet);
    const [address, setAddress] = useState('');
    const [result, setResult] = useState<IApprovalCheckResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    /** Submit the address for approval scanning. */
    const handleCheck = async () => {
        const trimmed = address.trim();
        if (trimmed.length < 34) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const data = await checkApprovals(trimmed);
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to check approvals');
        } finally {
            setLoading(false);
        }
    };

    if (!hasVerifiedWallet) {
        return (
            <Page>
                <PageHeader title="Token Approval Checker" subtitle="Scan a TRON wallet for active TRC20 token approvals" />
                <div className={styles.container}>
                    <Card>
                        <Stack gap="md">
                            <div className={styles.gate_message}>
                                <ShieldAlert size={24} />
                                <p>
                                    This tool requires a verified wallet. Use the wallet
                                    button in the page header to connect and sign a TronLink
                                    wallet — that flow handles both first-time verification
                                    and re-signing after a stale signature.
                                </p>
                            </div>
                        </Stack>
                    </Card>
                </div>
            </Page>
        );
    }

    return (
        <Page>
            <PageHeader title="Token Approval Checker" subtitle="Scan a TRON wallet for active TRC20 token approvals" />
            <div className={styles.container}>
            <Card>
                <Stack gap="md">
                    <label className={styles.label} htmlFor="approval-address">
                        TRON Wallet Address
                    </label>
                    <div className={styles.input_row}>
                        <Input
                            id="approval-address"
                            value={address}
                            onChange={e => setAddress(e.target.value)}
                            placeholder="T..."
                            onKeyDown={e => e.key === 'Enter' && handleCheck()}
                        />
                        <Button
                            variant="primary"
                            onClick={handleCheck}
                            disabled={loading || address.trim().length < 34}
                            loading={loading}
                        >
                            <Shield size={18} />
                            Check
                        </Button>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    {result && result.approvals.length === 0 && (
                        <p className={styles.empty}>No active token approvals found for this address.</p>
                    )}

                    {result && result.approvals.length > 0 && (
                        <div className={styles.results}>
                            <Table variant="compact">
                                <Thead>
                                    <Tr>
                                        <Th>Token</Th>
                                        <Th>Spender</Th>
                                        <Th>Allowance</Th>
                                        <Th width="shrink">Status</Th>
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
                                            <Td>
                                                <code className={styles.address_cell}>
                                                    {approval.spenderAddress}
                                                </code>
                                            </Td>
                                            <Td>{approval.allowanceFormatted}</Td>
                                            <Td>
                                                {approval.isUnlimited ? (
                                                    <span className="badge badge--danger">Unlimited</span>
                                                ) : (
                                                    <span className="badge badge--success">Limited</span>
                                                )}
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>

                            {result.truncated && (
                                <p className={styles.truncated}>
                                    Results truncated. Only the first 20 approval pairs are shown.
                                </p>
                            )}
                        </div>
                    )}
                </Stack>
            </Card>
            </div>
        </Page>
    );
}
