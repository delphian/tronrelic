'use client';

/**
 * @fileoverview Header button driving the auth surface.
 *
 * Anonymous visitors see "Sign in" — clicking opens `AuthModal` with
 * email-code, OAuth, and passkey options. Logged-in visitors see a short
 * identity pill — clicking navigates to `/profile`, the private settings hub
 * where wallet management, notifications, and sign-out now live.
 *
 * When an administrator has chosen an image on the Configuration tab of
 * `/system/system`, both states render that image as one round button instead.
 * The click still does the same thing for each state, and the accessible name
 * and tooltip say which action it takes and, when signed in, who is signed in.
 *
 * The file and component names are retained to minimise churn in the header
 * import graph (`MainHeader` imports `WalletButton`), but the affordance is
 * identity-driven rather than wallet-driven.
 */

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, User as UserIcon } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useAuthSession } from '../SessionProvider';
import { AuthModal } from '../AuthModal';
import styles from './WalletButton.module.scss';

/**
 * Props for the header auth button.
 */
interface IWalletButtonProps {
    /**
     * Image to render in place of both text states, as chosen by an
     * administrator. Omitted or null keeps the default "Sign in" button and
     * identity pill, which is what surfaces other than the header get.
     */
    imageUrl?: string | null;
}

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
 *
 * @param props - Optional administrator-chosen image for the button.
 * @returns The sign-in button, the identity pill, the image button, or
 *          nothing while the session is pending.
 */
export function WalletButton({ imageUrl = null }: IWalletButtonProps) {
    const { session, isLoggedIn, isPending } = useAuthSession();
    const { open, close } = useModal();
    const router = useRouter();

    /**
     * Open the sign-in dialog, closing it again once sign-in succeeds.
     */
    const openAuthModal = useCallback(() => {
        const id = open({
            title: 'Sign in',
            size: 'md',
            content: <AuthModal onSuccess={() => close(id)} />
        });
    }, [close, open]);

    /**
     * Send a signed-in visitor to their private profile page.
     */
    const goToProfile = useCallback(() => {
        router.push('/profile');
    }, [router]);

    const user = isLoggedIn ? session?.user ?? null : null;
    let content: ReactNode = null;

    if (isPending) {
        content = null;
    } else if (imageUrl) {
        const label = user ? `Open your profile (${buildIdentityLabel(user)})` : 'Sign in';
        content = (
            <button
                type="button"
                className={styles.image_btn}
                onClick={user ? goToProfile : openAuthModal}
                aria-label={label}
                title={label}
            >
                {/* Plain <img> is the project's convention for uploaded images.
                    The alt is empty because the button's aria-label already
                    names the action, and the image would only repeat it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" className={styles.image} />
            </button>
        );
    } else if (user) {
        const label = buildIdentityLabel(user);
        content = (
            <Button
                variant="secondary"
                size="sm"
                onClick={goToProfile}
                className={styles.identity_btn}
                aria-label="Open your profile"
            >
                <UserIcon size={14} aria-hidden />
                <span className={styles.identity_text}>{label}</span>
            </Button>
        );
    } else {
        content = (
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

    return content;
}
