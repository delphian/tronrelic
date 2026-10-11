'use client';

/**
 * @fileoverview Signs the current user out.
 *
 * Two controls sign out: the button on the profile page and the "Sign out"
 * entry at the bottom of the account tray. Both must end the session the same
 * way, report the result the same way, and refresh the page so every control
 * that depends on the session re-renders as signed out. The wiring lives here
 * once rather than in each caller.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../../components/ui/ToastProvider';
import { signOut } from '../lib/auth-client';

/**
 * What {@link useSignOut} hands back to a caller.
 */
export interface IUseSignOutResult {
    /** Ends the session, shows a toast with the outcome, and refreshes the route. */
    signOut: () => Promise<void>;
    /** True while the request is in flight, so a caller can disable or show a spinner on its control. */
    signingOut: boolean;
}

/**
 * Hook returning a function that signs the current user out.
 *
 * Better Auth's client usually reports a failed request in its returned
 * `error` field rather than throwing, so the result is checked as well as the
 * `catch`; otherwise a rejected sign-out would still announce "Signed out"
 * while the session stayed alive. On success the route is refreshed so server
 * components and auth gates re-evaluate without a manual reload.
 *
 * @returns The sign-out callback and whether a sign-out is in progress.
 */
export function useSignOut(): IUseSignOutResult {
    const router = useRouter();
    const { push } = useToast();
    const [signingOut, setSigningOut] = useState(false);

    /**
     * Sign out, then report the outcome and refresh on success.
     */
    const handleSignOut = useCallback(async (): Promise<void> => {
        setSigningOut(true);
        try {
            const result = await signOut();
            if (result?.error) {
                push({
                    tone: 'danger',
                    title: 'Sign out failed',
                    description: result.error.message ?? 'The server rejected the request.'
                });
            } else {
                push({ tone: 'success', title: 'Signed out' });
                router.refresh();
            }
        } catch (error) {
            push({
                tone: 'danger',
                title: 'Sign out failed',
                description: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setSigningOut(false);
        }
    }, [push, router]);

    return { signOut: handleSignOut, signingOut };
}
