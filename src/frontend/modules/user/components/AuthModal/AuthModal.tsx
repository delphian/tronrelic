'use client';

/**
 * @fileoverview Sign-in modal offering magic-link, OAuth, and passkey.
 *
 * Mounts inside `useModal()` from the global ModalProvider. Calls
 * Better Auth client methods directly — magic-link prompts for an
 * email and asks the backend to mail a one-time URL; OAuth redirects
 * the browser to the provider; passkey invokes the WebAuthn flow.
 *
 * The modal never closes itself for the magic-link branch (the success
 * state stays open showing "check your email"); OAuth and passkey
 * close on success — OAuth via the post-redirect callback URL, passkey
 * via the success handler that closes the modal explicitly.
 *
 * Provider availability is not introspected client-side: if the server
 * has Google/GitHub credentials unset, those `signIn.social` calls
 * return an error which the modal surfaces via toast. The buttons
 * stay rendered so deployment misconfiguration is visible to operators
 * rather than silently hidden.
 */

import { useCallback, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Github, KeyRound, Mail, Loader2 } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useToast } from '../../../../components/ui/ToastProvider';
import { signIn } from '../../lib/auth-client';
import styles from './AuthModal.module.scss';

/**
 * Props for the AuthModal body.
 *
 * `onSuccess` is invoked after a sign-in completes locally
 * (passkey only — OAuth and magic-link complete out-of-band).
 * Callers typically pass `() => closeModal(id)` so the modal
 * dismisses itself after a successful passkey ceremony.
 */
export interface IAuthModalProps {
    /**
     * URL to land on after a successful out-of-band sign-in (magic-link
     * click, OAuth callback). Defaults to the current path so the user
     * returns where they started. Pass an explicit path for flows that
     * should redirect somewhere specific (e.g. `/system` after admin
     * login).
     */
    callbackURL?: string;

    /**
     * Invoked when sign-in completes synchronously inside the modal
     * (passkey). The modal cannot close itself reliably without this
     * callback because the global ModalProvider owns the close handle.
     */
    onSuccess?: () => void;
}

/**
 * Magic-link / OAuth / passkey sign-in modal.
 *
 * @param props - {@link IAuthModalProps}.
 */
export function AuthModal({ callbackURL, onSuccess }: IAuthModalProps) {
    const router = useRouter();
    const { push } = useToast();
    const [email, setEmail] = useState('');
    const [pendingMethod, setPendingMethod] = useState<'magic-link' | 'google' | 'github' | 'passkey' | null>(null);
    const [magicLinkSent, setMagicLinkSent] = useState(false);

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

    const handleMagicLink = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const trimmed = email.trim();
            if (!trimmed) {
                push({ tone: 'warning', title: 'Email required', description: 'Enter an email to receive the sign-in link.' });
                return;
            }
            setPendingMethod('magic-link');
            try {
                const result = await signIn.magicLink({ email: trimmed, callbackURL: resolveCallback() });
                if (result?.error) {
                    showError('Magic link failed', result.error.message ?? 'The server rejected the request.');
                    return;
                }
                setMagicLinkSent(true);
            } catch (error) {
                showError('Magic link failed', error);
            } finally {
                setPendingMethod(null);
            }
        },
        [email, push, resolveCallback, showError]
    );

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

    if (magicLinkSent) {
        return (
            <div className={styles.modal}>
                <p className={styles.success}>
                    Check <strong>{email.trim()}</strong> for your sign-in link.
                </p>
                <p className={styles.hint}>The link expires in a few minutes. You can close this window — clicking the email will log you in here.</p>
            </div>
        );
    }

    return (
        <div className={styles.modal}>
            <form className={styles.form} onSubmit={handleMagicLink} noValidate>
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
                <Button type="submit" variant="primary" loading={pendingMethod === 'magic-link'} disabled={isBusy && pendingMethod !== 'magic-link'}>
                    <Mail size={16} aria-hidden /> Send magic link
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
