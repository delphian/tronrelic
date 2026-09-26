'use client';

/**
 * @fileoverview The site's sign-in / profile button.
 *
 * Rendered by the `core:auth-button` widget (`components/widgets/
 * AuthButtonWidget.tsx`), which an operator places from `/system/widgets`.
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
 * `AccountTray` can take over the click with `onActivate`, so the button opens
 * the tray of operator-configured links instead of signing in or navigating.
 * The button then carries `aria-expanded` and `aria-controls` for the tray.
 *
 * The file and component names are kept from when the button connected a
 * wallet; the affordance is now identity-driven rather than wallet-driven.
 */

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, User as UserIcon } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useAuthSession } from '../SessionProvider';
import { useSignInDialog } from '../../hooks';
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
    /**
     * Replaces the button's own click action. `AccountTray` passes this when
     * the visitor has tray links to see, so the click toggles the tray. Omitted
     * keeps the default: sign in when signed out, open the profile when signed in.
     */
    onActivate?: () => void;
    /** Whether the tray this button controls is open; only read with `onActivate`. */
    expanded?: boolean;
    /** Element id of the tray this button controls; only read with `onActivate`. */
    controlsId?: string;
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
 * @param props - Optional administrator-chosen image, plus the click override
 *   and tray state `AccountTray` supplies when it owns the click.
 * @returns The sign-in button, the identity pill, the image button, or
 *          nothing while the session is pending.
 */
export function WalletButton({ imageUrl = null, onActivate, expanded = false, controlsId }: IWalletButtonProps) {
    const { session, isLoggedIn, isPending } = useAuthSession();
    const openSignInDialog = useSignInDialog();
    const router = useRouter();

    /**
     * Send a signed-in visitor to their private profile page.
     */
    const goToProfile = useCallback(() => {
        router.push('/profile');
    }, [router]);

    const user = isLoggedIn ? session?.user ?? null : null;
    const identity = user ? buildIdentityLabel(user) : null;
    // With a tray the button no longer signs in or navigates by itself, so
    // its accessible name says what the click does now, and the ARIA pair
    // tells assistive technology which element it opens and whether it is open.
    const onClick = onActivate ?? (user ? goToProfile : openSignInDialog);
    const trayAria = onActivate
        ? { 'aria-expanded': expanded, 'aria-controls': controlsId }
        : {};
    let content: ReactNode = null;

    if (isPending) {
        content = null;
    } else if (imageUrl) {
        let label = user ? `Open your profile (${identity})` : 'Sign in';
        if (onActivate) {
            label = user ? `Account links (${identity})` : 'Sign in and links';
        }
        content = (
            <button
                type="button"
                className={styles.image_btn}
                onClick={onClick}
                aria-label={label}
                title={label}
                {...trayAria}
            >
                {/* Plain <img> is the project's convention for uploaded images.
                    The alt is empty because the button's aria-label already
                    names the action, and the image would only repeat it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" className={styles.image} />
            </button>
        );
    } else if (user) {
        content = (
            <Button
                variant="secondary"
                size="sm"
                onClick={onClick}
                className={styles.identity_btn}
                aria-label={onActivate ? `Account links (${identity})` : 'Open your profile'}
                {...trayAria}
            >
                <UserIcon size={14} aria-hidden />
                <span className={styles.identity_text}>{identity}</span>
            </Button>
        );
    } else {
        content = (
            <button
                type="button"
                className={styles.signin_btn}
                onClick={onClick}
                aria-label={onActivate ? 'Sign in and links' : 'Sign in'}
                {...trayAria}
            >
                <LogIn size={14} aria-hidden />
                <span className={styles.signin_text}>Sign in</span>
            </button>
        );
    }

    return content;
}
