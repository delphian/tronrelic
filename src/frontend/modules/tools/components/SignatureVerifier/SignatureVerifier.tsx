/**
 * @fileoverview Signature verifier tool page.
 *
 * Verifies that a TRON wallet signed a specific message. Supports direct URL
 * linking via query parameters (?wallet=...&message=...&signature=...) for
 * external integrations that want to provide a verification link.
 */
'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck, CheckCircle, XCircle } from 'lucide-react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { verifySignature } from '../../api/client';
import styles from './SignatureVerifier.module.scss';

/**
 * Signature verifier tool.
 *
 * Three input fields: wallet address, message, and signature. On submit,
 * calls the backend to verify via TronWeb. Supports pre-filling from URL
 * query parameters and auto-verifying when all three are present.
 */
export function SignatureVerifier() {
    const searchParams = useSearchParams();

    const [wallet, setWallet] = useState('');
    const [message, setMessage] = useState('');
    const [signature, setSignature] = useState('');
    const [verified, setVerified] = useState<boolean | null>(null);
    const [normalizedWallet, setNormalizedWallet] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    /** Pre-fill from URL parameters and auto-verify if all present. */
    useEffect(() => {
        const w = searchParams.get('wallet') ?? '';
        const m = searchParams.get('message') ?? '';
        const s = searchParams.get('signature') ?? '';

        if (w) setWallet(w);
        if (m) setMessage(m);
        if (s) setSignature(s);

        if (w && m && s) {
            void handleVerify(w, m, s);
        }
    // Only run on initial mount with URL params
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Submit verification request. */
    const handleVerify = async (w?: string, m?: string, s?: string) => {
        const walletVal = w ?? wallet;
        const messageVal = m ?? message;
        const signatureVal = s ?? signature;

        if (!walletVal || !messageVal || !signatureVal) return;

        setLoading(true);
        setError(null);
        setVerified(null);
        setNormalizedWallet(null);

        try {
            const result = await verifySignature(walletVal, messageVal, signatureVal);
            setVerified(result.verified);
            setNormalizedWallet(result.wallet);
        } catch (err) {
            setVerified(false);
            setError(err instanceof Error ? err.message : 'Verification failed');
        } finally {
            setLoading(false);
        }
    };

    const canSubmit = wallet.trim() && message.trim() && signature.trim();

    return (
        <Page>
            <PageHeader title="Signature Verifier" subtitle="Verify a TRON wallet signed a specific message" />
            <Card>
                <Stack gap="md">
                    <div>
                        <label className={styles.label} htmlFor="wallet-input">Wallet Address</label>
                        <Input
                            id="wallet-input"
                            value={wallet}
                            onChange={e => setWallet(e.target.value)}
                            placeholder="T... or 41..."
                        />
                    </div>
                    <div>
                        <label className={styles.label} htmlFor="message-input">Message</label>
                        <Input
                            id="message-input"
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="The exact message that was signed"
                        />
                    </div>
                    <div>
                        <label className={styles.label} htmlFor="signature-input">Signature</label>
                        <Input
                            id="signature-input"
                            value={signature}
                            onChange={e => setSignature(e.target.value)}
                            placeholder="0x..."
                        />
                    </div>
                    <Button
                        variant="primary"
                        onClick={() => handleVerify()}
                        disabled={loading || !canSubmit}
                        loading={loading}
                    >
                        <ShieldCheck size={18} />
                        Verify Signature
                    </Button>

                    {error && <p className={styles.error}>{error}</p>}

                    {verified !== null && (
                        <div className={`${styles.result} ${verified ? styles['result--success'] : styles['result--failure']}`}>
                            <div className={styles.result__icon}>
                                {verified
                                    ? <CheckCircle size={24} style={{ color: 'var(--color-success)' }} />
                                    : <XCircle size={24} style={{ color: 'var(--color-danger)' }} />
                                }
                            </div>
                            <div className={styles.result__body}>
                                <span className={styles.result__status}>
                                    {verified ? 'Signature Valid' : 'Signature Invalid'}
                                </span>
                                {normalizedWallet && (
                                    <code className={styles.result__wallet}>{normalizedWallet}</code>
                                )}
                            </div>
                        </div>
                    )}
                </Stack>
            </Card>
        </Page>
    );
}
