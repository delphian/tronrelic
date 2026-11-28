/**
 * @fileoverview The signature verifier's form and result, without page chrome.
 *
 * The verifier is served inside a CMS page body as the
 * `tools:signature-verifier` widget, and the CMS page supplies the heading and
 * text around it, so this component draws no page header of its own.
 *
 * Verifies that a TRON wallet signed a specific message. External sites link
 * to the page with the wallet, message, and signature in its query string; the
 * widget reads them and passes them in here, and the form verifies on load
 * when all three are present.
 */
'use client';

import { useEffect, useId, useState } from 'react';
import { ShieldCheck, CheckCircle, XCircle } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { verifySignature } from '../../api/client';
import styles from './SignatureVerifier.module.scss';

/** Props for {@link SignatureVerifierForm}. */
interface ISignatureVerifierFormProps {
    /** Wallet the field starts with, taken from the page link's `?wallet=` or `?address=`. */
    initialWallet?: string;
    /** Message the field starts with, taken from the page link's `?message=`. */
    initialMessage?: string;
    /** Signature the field starts with, taken from the page link's `?signature=`. */
    initialSignature?: string;
}

/**
 * Signature verifier form.
 *
 * Three input fields: wallet address, message, and signature. On submit, calls
 * the backend to verify via TronWeb. When all three start filled, the form
 * verifies once on mount, so a verification link shows its answer without a
 * click. The fields are read once, so they never overwrite what the visitor types.
 *
 * @param props - Component props.
 * @param props.initialWallet - Wallet the field starts with, if the page link carried one.
 * @param props.initialMessage - Message the field starts with, if the page link carried one.
 * @param props.initialSignature - Signature the field starts with, if the page link carried one.
 * @returns The verifier card.
 */
export function SignatureVerifierForm({ initialWallet = '', initialMessage = '', initialSignature = '' }: ISignatureVerifierFormProps) {
    const [wallet, setWallet] = useState(initialWallet);
    const [message, setMessage] = useState(initialMessage);
    const [signature, setSignature] = useState(initialSignature);
    const [verified, setVerified] = useState<boolean | null>(null);
    const [normalizedWallet, setNormalizedWallet] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation();
    // A page can embed the verifier more than once, so each instance needs its
    // own input ids for the labels to point at the right field.
    const walletId = useId();
    const messageId = useId();
    const signatureId = useId();

    /** Submit the current fields for verification. */
    const handleVerify = async () => {
        if (!wallet || !message || !signature) return;

        setLoading(true);
        setError(null);
        setVerified(null);
        setNormalizedWallet(null);

        try {
            const result = await verifySignature(wallet, message, signature);
            setVerified(result.verified);
            setNormalizedWallet(result.wallet);
        } catch (err) {
            setVerified(false);
            setError(err instanceof Error ? err.message : t('tools.signatureVerifier.error.failed', 'Verification failed'));
        } finally {
            setLoading(false);
        }
    };

    /**
     * Verify once on mount when a link supplied all three fields, so the
     * visitor sees the answer the link was made to show.
     */
    useEffect(() => {
        if (initialWallet && initialMessage && initialSignature) {
            void handleVerify();
        }
    // Mount only: the initial values are read once and later typing must not re-verify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const canSubmit = wallet.trim() && message.trim() && signature.trim();

    return (
        <Card>
            <Stack gap="md">
                <div>
                    <label className={styles.label} htmlFor={walletId}>{t('tools.signatureVerifier.walletLabel', 'Wallet Address')}</label>
                    <Input
                        id={walletId}
                        value={wallet}
                        onChange={e => setWallet(e.target.value)}
                        placeholder={t('tools.signatureVerifier.walletPlaceholder', 'T... or 41...')}
                    />
                </div>
                <div>
                    <label className={styles.label} htmlFor={messageId}>{t('tools.signatureVerifier.messageLabel', 'Message')}</label>
                    <Input
                        id={messageId}
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        placeholder={t('tools.signatureVerifier.messagePlaceholder', 'The exact message that was signed')}
                    />
                </div>
                <div>
                    <label className={styles.label} htmlFor={signatureId}>{t('tools.signatureVerifier.signatureLabel', 'Signature')}</label>
                    <Input
                        id={signatureId}
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
                    {t('tools.signatureVerifier.submit', 'Verify Signature')}
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
                                {verified
                                    ? t('tools.signatureVerifier.valid', 'Signature Valid')
                                    : t('tools.signatureVerifier.invalid', 'Signature Invalid')}
                            </span>
                            {normalizedWallet && (
                                <TronAddress address={normalizedWallet} className={styles.result__wallet} />
                            )}
                        </div>
                    </div>
                )}
            </Stack>
        </Card>
    );
}
