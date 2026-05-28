'use client';

/**
 * @fileoverview Sign-in modal offering email-OTP, OAuth, and passkey.
 *
 * Mounts inside `useModal()` from the global ModalProvider. Calls Better
 * Auth client methods directly. The email path is a two-step code flow:
 * the user enters an email and we mail a one-time code, then they type
 * the code back into this same tab to complete sign-in. OAuth redirects
 * the browser to the provider; passkey invokes the WebAuthn flow.
 *
 * Why a code instead of a magic link: email clients (notably Gmail
 * mobile) open links in an in-app webview, which would set the session
 * in a sandbox separate from the user's real browser, and link-scanners
 * can pre-consume single-use verify URLs. A code typed back into the
 * originating tab signs in exactly where the user started.
 *
 * The modal closes on success for every path: email-OTP and passkey via
 * the explicit success handler after the session is created in-tab,
 * OAuth via the post-redirect callback URL.
 *
 * Provider availability is not introspected client-side: if the server
 * has Google/GitHub credentials unset (or email-OTP disabled because
 * Resend is unconfigured), those calls return an error which the modal
 * surfaces via toast. The buttons stay rendered so deployment
 * misconfiguration is visible to operators rather than silently hidden.
 */

import { useCallback, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Github, KeyRound, Mail, Loader2 } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useToast } from '../../../../components/ui/ToastProvider';
import { signIn, emailOtp } from '../../lib/auth-client';
import styles from './AuthModal.module.scss';

/**
 * Props for the AuthModal body.
 *
 * `onSuccess` is invoked after a sign-in completes in this tab (email-OTP
 * and passkey). OAuth completes out-of-band via redirect. Callers
 * typically pass `() => closeModal(id)` so the modal dismisses itself.
 */
export interface IAuthModalProps {
    /**
     * URL to land on after a successful OAuth redirect. Defaults to the
     * current path so the user returns where they started. Pass an
     * explicit path for flows that should redirect somewhere specific
     * (e.g. `/system` after admin login). Unused by the email-OTP and
     * passkey paths, which complete in-tab.
     */
    callbackURL?: string;

    /**
     * Invoked when sign-in completes synchronously inside the modal
     * (email-OTP, passkey). The modal cannot close itself reliably
     * without this callback because the global ModalProvider owns the
     * close handle.
     */
    onSuccess?: () => void;
}

/**
 * Email-OTP / OAuth / passkey sign-in modal.
 *
 * @param props - {@link IAuthModalProps}.
 */
export function AuthModal({ callbackURL, onSuccess }: IAuthModalProps) {
    const router = useRouter();
    const { push } = useToast();
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [pendingMethod, setPendingMethod] = useState<'email' | 'verify' | 'google' | 'github' | 'passkey' | null>(null);
    const [otpSent, setOtpSent] = useState(false);

    const isBusy = pendingMethod !== null;

    const resolveCallback = useCallback((): string => {
        if (callbackURL) {
            return callbackURL;
        }
        if (typeof window !== 'undefined') {
            return window.location.pathname + window.location.search;
        }
        return '/';
    }, [callbackURL]);

    const showError = useCallback(
        (title: string, error: unknown) => {
            const description = error instanceof Error ? error.message : String(error);
            push({ tone: 'danger', title, description });
        },
        [push]
    );

    const handleSendCode = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const trimmed = email.trim();
            if (!trimmed) {
                push({ tone: 'warning', title: 'Email required', description: 'Enter an email to receive a sign-in code.' });
                return;
            }
            setPendingMethod('email');
            try {
                const result = await emailOtp.sendVerificationOtp({ email: trimmed, type: 'sign-in' });
                if (result?.error) {
                    showError('Could not send code', result.error.message ?? 'The server rejected the request.');
                    return;
                }
                setOtpSent(true);
            } catch (error) {
                showError('Could not send code', error);
            } finally {
                setPendingMethod(null);
            }
        },
        [email, push, showError]
    );

    const handleVerifyCode = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const trimmedEmail = email.trim();
            const trimmedCode = code.trim();
            if (!trimmedCode) {
                push({ tone: 'warning', title: 'Code required', description: 'Enter the code from your email.' });
                return;
            }
            setPendingMethod('verify');
            try {
                const result = await signIn.emailOtp({ email: trimmedEmail, otp: trimmedCode });
                if (result?.error) {
                    showError('Sign-in failed', result.error.message ?? 'That code is invalid or expired.');
                    return;
                }
                push({ tone: 'success', title: 'Signed in', description: 'Welcome back.' });
                router.refresh();
                onSuccess?.();
            } catch (error) {
                showError('Sign-in failed', error);
            } finally {
                setPendingMethod(null);
            }
        },
        [code, email, onSuccess, push, router, showError]
    );

    const handleChangeEmail = useCallback(() => {
        setOtpSent(false);
        setCode('');
    }, []);

    const handleSocial = useCallback(
        async (provider: 'google' | 'github') => {
            setPendingMethod(provider);
            try {
                const result = await signIn.social({ provider, callbackURL: resolveCallback() });
                if (result?.error) {
                    showError(`${provider === 'google' ? 'Google' : 'GitHub'} sign-in failed`, result.error.message ?? 'The provider is not configured.');
                }
                // On success the browser is redirected — no further work needed.
            } catch (error) {
                showError(`${provider === 'google' ? 'Google' : 'GitHub'} sign-in failed`, error);
            } finally {
                setPendingMethod(null);
            }
        },
        [resolveCallback, showError]
    );

    const handlePasskey = useCallback(async () => {
        setPendingMethod('passkey');
        try {
            const result = await signIn.passkey();
            if (result?.error) {
                showError('Passkey sign-in failed', result.error.message ?? 'No passkey was matched.');
                return;
            }
            push({ tone: 'success', title: 'Signed in', description: 'Welcome back.' });
            router.refresh();
            onSuccess?.();
        } catch (error) {
            showError('Passkey sign-in failed', error);
        } finally {
            setPendingMethod(null);
        }
    }, [onSuccess, push, router, showError]);

    if (otpSent) {
        return (
            <div className={styles.modal}>
                <form className={styles.form} onSubmit={handleVerifyCode} noValidate>
                    <p className={styles.hint}>
                        Enter the code we emailed to <strong>{email.trim()}</strong>.
                    </p>
                    <label className={styles.label} htmlFor="auth-modal-code">
                        Sign-in code
                    </label>
                    <input
                        id="auth-modal-code"
                        className={styles.input}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        disabled={isBusy}
                        autoFocus
                        required
                    />
                    <Button type="submit" variant="primary" loading={pendingMethod === 'verify'} disabled={isBusy && pendingMethod !== 'verify'}>
                        Verify &amp; sign in
                    </Button>
                </form>
                <div className={styles.providers}>
                    <Button variant="ghost" onClick={handleChangeEmail} disabled={isBusy}>
                        Use a different email
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.modal}>
            <form className={styles.form} onSubmit={handleSendCode} noValidate>
                <label className={styles.label} htmlFor="auth-modal-email">
                    Email
                </label>
                <input
                    id="auth-modal-email"
                    className={styles.input}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isBusy}
                    required
                />
                <Button type="submit" variant="primary" loading={pendingMethod === 'email'} disabled={isBusy && pendingMethod !== 'email'}>
                    <Mail size={16} aria-hidden /> Send code
                </Button>
            </form>

            <div className={styles.divider} role="separator">
                <span>or continue with</span>
            </div>

            <div className={styles.providers}>
                <Button
                    variant="secondary"
                    onClick={() => handleSocial('google')}
                    loading={pendingMethod === 'google'}
                    disabled={isBusy && pendingMethod !== 'google'}
                    aria-label="Sign in with Google"
                >
                    <span className={styles.provider_glyph} aria-hidden>G</span> Google
                </Button>
                <Button
                    variant="secondary"
                    onClick={() => handleSocial('github')}
                    loading={pendingMethod === 'github'}
                    disabled={isBusy && pendingMethod !== 'github'}
                    aria-label="Sign in with GitHub"
                >
                    <Github size={16} aria-hidden /> GitHub
                </Button>
                <Button
                    variant="secondary"
                    onClick={handlePasskey}
                    loading={pendingMethod === 'passkey'}
                    disabled={isBusy && pendingMethod !== 'passkey'}
                    aria-label="Sign in with a passkey"
                >
                    {pendingMethod === 'passkey' ? <Loader2 size={16} className={styles.spinner} aria-hidden /> : <KeyRound size={16} aria-hidden />}
                    Passkey
                </Button>
            </div>
        </div>
    );
}
