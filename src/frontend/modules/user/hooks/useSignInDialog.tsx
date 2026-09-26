'use client';

/**
 * @fileoverview Opens the site's sign-in dialog.
 *
 * Two controls start sign-in: the sign-in button itself, and the "Sign in"
 * entry the account tray adds for signed-out visitors. Both must open the
 * same dialog with the same title and close it the same way on success, so
 * the wiring lives here once rather than in each caller.
 */

import { useCallback } from 'react';
import { useModal } from '../../../components/ui/ModalProvider';
import { AuthModal } from '../components/AuthModal';

/**
 * Hook returning a function that opens the sign-in dialog.
 *
 * The dialog closes itself once sign-in succeeds; the session provider then
 * re-renders every control that depends on whether the visitor is signed in,
 * so the caller has nothing further to do.
 *
 * @returns A stable callback that opens the sign-in dialog when called.
 */
export function useSignInDialog(): () => void {
    const { open, close } = useModal();

    /**
     * Open the sign-in dialog, closing it again once sign-in succeeds.
     */
    const openSignInDialog = useCallback(() => {
        const id = open({
            title: 'Sign in',
            size: 'md',
            content: <AuthModal onSuccess={() => close(id)} />
        });
    }, [close, open]);

    return openSignInDialog;
}
