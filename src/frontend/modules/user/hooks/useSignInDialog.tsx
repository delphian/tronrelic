'use client';

/**
 * @fileoverview Opens the site's sign-in dialog.
 *
 * Several controls start sign-in: the sign-in button itself, the "Sign in"
 * entry the account tray adds for signed-out visitors, and any feature that
 * only signed-in users may use. All of them must open the same dialog with
 * the same title and close it the same way on success, so the wiring lives
 * here once rather than in each caller.
 */

import { useCallback } from 'react';
import { useModal } from '../../../components/ui/ModalProvider';
import { AuthModal } from '../components/AuthModal';

/**
 * Options a caller may pass when opening the sign-in dialog.
 */
export interface ISignInDialogOptions {
    /**
     * Text shown above the sign-in options. A feature that requires an
     * account passes this when a signed-out visitor tries to use it, so the
     * dialog says why it appeared, for example "Saving alerts requires an
     * account. Sign in or create one to continue." Omitted opens the plain
     * dialog.
     */
    message?: string;
}

/**
 * Hook returning a function that opens the sign-in dialog.
 *
 * The dialog closes itself once sign-in succeeds; the session provider then
 * re-renders every control that depends on whether the visitor is signed in,
 * so the caller has nothing further to do.
 *
 * Do not pass the returned function straight to an `onClick` prop. React
 * would call it with the click event as the first argument, which is not a
 * set of options. Wrap it instead, as `onClick={() => openSignInDialog()}`.
 *
 * @returns A stable callback that opens the sign-in dialog when called,
 *          taking optional {@link ISignInDialogOptions}.
 */
export function useSignInDialog(): (options?: ISignInDialogOptions) => void {
    const { open, close } = useModal();

    /**
     * Open the sign-in dialog, closing it again once sign-in succeeds.
     *
     * @param options - Optional message explaining why sign-in is needed.
     */
    const openSignInDialog = useCallback((options?: ISignInDialogOptions) => {
        const id = open({
            title: 'Sign in',
            size: 'md',
            content: <AuthModal message={options?.message} onSuccess={() => close(id)} />
        });
    }, [close, open]);

    return openSignInDialog;
}
