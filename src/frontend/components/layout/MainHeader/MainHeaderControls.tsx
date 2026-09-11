/**
 * MainHeaderControls Component (Client Component)
 *
 * Interactive controls for the main header. Currently only renders the
 * wallet button — themes are global (applied site-wide whenever an admin
 * enables them) and no longer surface a per-user toggle here.
 */
'use client';

import { WalletButton } from '../../../modules/user';
import styles from './MainHeader.module.scss';

/**
 * Props for the header's interactive controls.
 */
interface IMainHeaderControlsProps {
    /**
     * Image to show in place of the sign-in button, read by the server-side
     * header from the branding settings. Null keeps the default text button.
     */
    authButtonImageUrl: string | null;
}

/**
 * Interactive header controls component.
 *
 * Provides client-side interactive features for the main header:
 * - Wallet connection button via WalletButton from modules/user
 *
 * @param props - The branding the server-side header resolved for this render.
 * @returns The controls row for the header.
 */
export function MainHeaderControls({ authButtonImageUrl }: IMainHeaderControlsProps) {
    return (
        <div className={styles.controls}>
            <WalletButton imageUrl={authButtonImageUrl} />
        </div>
    );
}
