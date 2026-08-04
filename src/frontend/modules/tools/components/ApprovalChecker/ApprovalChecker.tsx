/**
 * @fileoverview Token approval checker tool page.
 *
 * Scans a TRON wallet for active TRC20 token approvals by querying TronGrid
 * for historical Approval events and checking live allowance values. Displays
 * results in a table with unlimited approval warnings.
 * User-triggered action — loading state is appropriate here.
 */
'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Shield, ShieldAlert } from 'lucide-react';
// Direct import (not the modules/user barrel) keeps component CSS out of the bundle.
import { useAuthSession } from '../../../user/components/SessionProvider';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { AddressSelector } from '../../../../components/ui/AddressSelector';
import { isValidTronAddress } from '../../../../lib/tronAddress';
import { Button } from '../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { TronAddress } from '../../../../components/ui/TronAddress';
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
    const { isLoggedIn } = useAuthSession();
    const searchParams = useSearchParams();
    // Null rather than '' because AddressSelector only ever hands back a
    // validated address or nothing — there is no partial value to hold.
    const [address, setAddress] = useState<string | null>(null);
    const [result, setResult] = useState<IApprovalCheckResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    /**
     * Pre-fill from a forwarded `?address=` param on mount, why: the shared
     * TronAddress chip forwards a full address here via that param. The param
     * is anyone-editable, so it is validated before it becomes state — an
     * unchecked value would render as AddressSelector's selected chip and arm
     * the Check button with something the backend will reject. Pre-filling
     * still runs when the visitor is signed out, so the field is ready the
     * moment they authenticate. Mount only so it never overrides later typing.
     */
    useEffect(() => {
        const forwarded = searchParams.get('address')?.trim();
        if (forwarded && isValidTronAddress(forwarded)) setAddress(forwarded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Submit the address for approval scanning. */
    const handleCheck = async () => {
        // AddressSelector guarantees a validated address or null, so presence
        // is the whole precondition — no length heuristic needed.
        const trimmed = address;
        if (!trimmed) return;

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

    if (!isLoggedIn) {
        return (
            <Page>
                <PageHeader title="Token Approval Checker" subtitle="Scan a TRON wallet for active TRC20 token approvals" />
                <div className={styles.container}>
                    <Card>
                        <Stack gap="md">
                            <div className={styles.gate_message}>
                                <ShieldAlert size={24} />
                                <p>
                                    This tool requires you to be signed in. Use the sign-in
                                    button in the page header to authenticate, then return here.
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
                    {/* A span, not a <label>: AddressSelector owns its own
                        input and names it via aria-label, so a `htmlFor`
                        pointing at an id this component no longer renders
                        would be a dangling association. */}
                    <span className={styles.label}>TRON Wallet Address</span>
                    <div className={styles.input_row}>
                        <AddressSelector
                            value={address}
                            onChange={setAddress}
                            aria-label="TRON wallet address"
                        />
                        <Button
                            variant="primary"
                            onClick={handleCheck}
                            disabled={loading || !address}
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
                                                <TronAddress address={approval.spenderAddress} />
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
