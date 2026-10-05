'use client';

/**
 * @fileoverview The sign-in and consent screen an app sends a user to when it
 * asks to act on their TronRelic account (the OAuth authorize step).
 *
 * Better Auth sends the browser here with a signed authorization query in the
 * URL. The page does three jobs:
 *
 * - Signed out: ask the user to sign in. The Better Auth client copies the
 *   signed query into the sign-in request, and after sign-in the server
 *   resumes the authorization and redirects, either back here for consent or
 *   straight to the app if the user already approved it.
 * - Signed in and allowed: show who is asking, where the result goes, and
 *   what access is requested, with Allow and Deny.
 * - Signed in but not in the MCP group: say so and offer only Deny, which
 *   sends a clean "access denied" back to the app.
 *
 * Nothing here is trusted by the server. The consent request re-verifies the
 * signed query, so a hand-edited URL can change what this page displays but
 * can never produce an authorization code.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, LogIn, ShieldAlert, X } from 'lucide-react';
import type { IOAuthConsentContext } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Stack } from '../../../../components/layout';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useAuthSession } from '../SessionProvider';
import { useSignInDialog } from '../../hooks';
import { authClient } from '../../lib/auth-client';
import { displayHost } from '../../lib/displayHost';
import styles from './OAuthConsent.module.scss';

/**
 * Props for {@link OAuthConsent}.
 */
export interface IOAuthConsentProps {
    /** Details of the requesting app, resolved during server rendering; null when signed out or unidentifiable. */
    context: IOAuthConsentContext | null;

    /** Whether the visitor was signed in when the page was rendered on the server. */
    signedInOnServer: boolean;
}

/** What the consent endpoint answers with: where to send the browser next. */
interface IConsentResponse {
    redirect?: boolean;
    url?: string;
}

/**
 * The authorize page body.
 *
 * @param props - {@link IOAuthConsentProps}.
 * @returns The sign-in prompt, the consent card, or the not-permitted card.
 */
export function OAuthConsent({ context, signedInOnServer }: IOAuthConsentProps) {
    const { isLoggedIn, isPending } = useAuthSession();
    const openSignInDialog = useSignInDialog();
    const router = useRouter();
    const { push } = useToast();
    const [working, setWorking] = useState<'allow' | 'deny' | null>(null);

    /**
     * After an in-page sign-in, the server normally redirects the browser on
     * its own. If it did not (the user closed and reopened the dialog, or the
     * signed query had already expired), re-render on the server so the
     * consent details load with the new session instead of leaving a blank card.
     */
    useEffect(() => {
        if (isLoggedIn && !signedInOnServer && !context) {
            router.refresh();
        }
    }, [isLoggedIn, signedInOnServer, context, router]);

    /**
     * Send the user's decision to Better Auth and follow the redirect it
     * returns: back to the app with a code on Allow, or with `access_denied`
     * on Deny. The client plugin adds the signed query to the request body.
     *
     * @param accept - True to approve the app, false to refuse it.
     */
    const decide = useCallback(async (accept: boolean): Promise<void> => {
        setWorking(accept ? 'allow' : 'deny');
        try {
            const { data, error } = await authClient.$fetch<IConsentResponse>('/oauth2/consent', {
                method: 'POST',
                body: { accept }
            });
            if (error || !data?.url) {
                throw new Error(error?.message || 'The authorization request has expired. Start again from your app.');
            }
            window.location.assign(data.url);
        } catch (err) {
            setWorking(null);
            push({ tone: 'danger', title: 'Could not complete the request', description: err instanceof Error ? err.message : String(err) });
        }
    }, [push]);

    let body: ReactNode = null;
    if (isPending) {
        body = null;
    } else if (!isLoggedIn) {
        body = (
            <Card>
                <Stack gap="md">
                    <p>An app is asking to connect to your TronRelic account. Sign in to review the request.</p>
                    <div>
                        <Button variant="primary" icon={<LogIn size={18} aria-hidden />} onClick={() => openSignInDialog()}>
                            Sign in to continue
                        </Button>
                    </div>
                </Stack>
            </Card>
        );
    } else if (!context) {
        body = (
            <Card>
                <Stack gap="md">
                    <p className={styles.warning_line}>
                        <AlertTriangle size={18} aria-hidden className={styles.warning_icon} />
                        This app could not be identified, or the request has expired. Start again from the app.
                    </p>
                    <div>
                        <Button variant="ghost" icon={<X size={18} aria-hidden />} loading={working === 'deny'} disabled={working !== null} onClick={() => { void decide(false); }}>
                            Cancel request
                        </Button>
                    </div>
                </Stack>
            </Card>
        );
    } else {
        body = (
            <Card>
                <Stack gap="md">
                    <div className={styles.client}>
                        <span className={styles.client_name}>{context.clientName}</span>
                        <span className={styles.client_meta}>
                            Identifies itself as {context.clientUri ? displayHost(context.clientUri) : displayHost(context.clientId)}.
                            The name is the app&apos;s own claim.
                        </span>
                    </div>

                    <dl className={styles.facts}>
                        <dt>Sends the result to</dt>
                        <dd>
                            <Badge tone="neutral" size="sm">{context.redirectHost}</Badge>
                            {context.loopbackOnly && <Badge tone="info" size="sm">This computer</Badge>}
                        </dd>
                        <dt>Asks to</dt>
                        <dd>
                            <ul className={styles.scope_list}>
                                {context.scopes.map(item => (
                                    <li key={item.scope}>{item.label}</li>
                                ))}
                            </ul>
                        </dd>
                    </dl>

                    {context.loopbackOnly && (
                        <p className={styles.note}>
                            The result goes to a program on this computer, which is normal for local tools such as
                            Claude Code. Only allow it if you started the connection yourself.
                        </p>
                    )}

                    {context.permitted ? (
                        <div className={styles.actions}>
                            <Button variant="primary" icon={<Check size={18} aria-hidden />} loading={working === 'allow'} disabled={working !== null} onClick={() => { void decide(true); }}>
                                Allow
                            </Button>
                            <Button variant="ghost" icon={<X size={18} aria-hidden />} loading={working === 'deny'} disabled={working !== null} onClick={() => { void decide(false); }}>
                                Deny
                            </Button>
                        </div>
                    ) : (
                        <Stack gap="sm">
                            <p className={styles.warning_line}>
                                <ShieldAlert size={18} aria-hidden className={styles.warning_icon} />
                                Your account is not permitted to connect apps to TronRelic. Ask an administrator for access.
                            </p>
                            <div>
                                <Button variant="ghost" icon={<X size={18} aria-hidden />} loading={working === 'deny'} disabled={working !== null} onClick={() => { void decide(false); }}>
                                    Deny
                                </Button>
                            </div>
                        </Stack>
                    )}

                    <p className={styles.note}>You can revoke access at any time from Connected apps on your profile.</p>
                </Stack>
            </Card>
        );
    }
    return body;
}
