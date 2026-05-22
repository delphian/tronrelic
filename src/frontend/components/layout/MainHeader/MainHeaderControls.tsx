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
 * Interactive header controls component.
 *
 * Provides client-side interactive features for the main header:
 * - Wallet connection button via WalletButton from modules/user
 */
export function MainHeaderControls() {
    return (
        <div className={styles.controls}>
            <WalletButton />
        </div>
    );
}
