'use client';

/**
 * @fileoverview Header button driving the Phase 3 auth surface.
 *
 * Anonymous visitors see "Sign in" — clicking opens `AuthModal` with
 * email-code, OAuth, and passkey options. Logged-in visitors see a
 * short identity pill — clicking opens `ProfileMenu` for sign-out
 * and (legacy) wallet actions.
 *
 * Phase 3 keeps the file name and component name to minimise churn
 * in the header import graph (`MainHeader` imports `WalletButton`),
 * but the affordance is now identity-driven rather than wallet-driven.
 * Phase 4 will move the wallet flow into a proper anchored popover.
 */

import { useCallback } from 'react';
import { LogIn, User as UserIcon } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useAuthSession } from '../SessionProvider';
import { AuthModal } from '../AuthModal';
import { ProfileMenu } from '../ProfileMenu';
import styles from './WalletButton.module.scss';

/**
 * Render an identity label suitable for a tight header button.
 *
 * Prefers the email's local-part; falls back to the user's name or a
 * short prefix of their id. Long emails get truncated with an ellipsis
 * so the pill stays the same width regardless of provider.
 *
 * @param user - BA user record.
 * @returns Display string for the header pill.
 */
function buildIdentityLabel(user: { email?: string | null; name?: string | null; id: string }): string {
    if (user.email) {
        const local = user.email.split('@')[0] ?? user.email;
        return local.length > 14 ? `${local.slice(0, 14)}…` : local;
    }
    if (user.name) {
        return user.name.length > 14 ? `${user.name.slice(0, 14)}…` : user.name;
    }
    return user.id.slice(0, 8);
}

/**
 * Header auth/profile button.
 *
 * Renders nothing while the session is genuinely pending — i.e. the
 * SSR seed was absent and the live BA fetch has not yet completed —
 * so visitors arriving without a session don't see a flash from
 * "(blank)" to "Sign in." The pending window is normally a single
 * client tick because SSR resolves the session before render; only
 * cold loads with no cookie hit this code path.
 */
export function WalletButton() {
    const { session, isLoggedIn, isPending } = useAuthSession();
    const { open, close } = useModal();

    const openAuthModal = useCallback(() => {
        const id = open({
            title: 'Sign in',
            size: 'md',
            content: <AuthModal onSuccess={() => close(id)} />
        });
    }, [close, open]);

    const openProfileMenu = useCallback(() => {
        const id = open({
            title: 'Account',
            size: 'sm',
            content: <ProfileMenu session={session} onClose={() => close(id)} />
        });
    }, [close, open, session]);

    if (isPending) {
        return null;
    }

    if (isLoggedIn && session?.user) {
        const label = buildIdentityLabel(session.user);
        return (
            <Button
                variant="secondary"
                size="sm"
                onClick={openProfileMenu}
                className={styles.identity_btn}
                aria-label="Open account menu"
            >
                <UserIcon size={14} aria-hidden />
                <span className={styles.identity_text}>{label}</span>
            </Button>
        );
    }

    return (
        <button
            type="button"
            className={styles.signin_btn}
            onClick={openAuthModal}
            aria-label="Sign in"
        >
            <LogIn size={14} aria-hidden />
            <span className={styles.signin_text}>Sign in</span>
        </button>
    );
}
