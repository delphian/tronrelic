/**
 * MainHeaderControls Component (Client Component)
 *
 * Interactive controls for the main header including theme toggle and wallet connection.
 * Separated from MainHeader server component to enable client-side interactivity.
 *
 * SSR + Live Updates Pattern:
 * - Receives theme data from server component for immediate rendering
 * - Theme toggle buttons render with SSR data (no loading flash)
 * - After hydration, client handles theme switching interactively
 *
 * @example
 * ```tsx
 * // Used by MainHeader (server component)
 * <MainHeaderControls initialThemes={themes} initialThemeId={selectedThemeId} />
 * ```
 */
'use client';

import type { IOrderedTheme } from '../../../app/layout';
import { ThemeToggle } from '../../ThemeToggle';
import { WalletButton } from '../../../modules/user';
import styles from './MainHeader.module.css';

/**
 * Props for the MainHeaderControls component.
 */
interface MainHeaderControlsProps {
    /**
     * Active themes fetched during SSR for immediate toggle button rendering.
     */
    initialThemes: IOrderedTheme[];
    /**
     * Currently selected theme ID from cookie, read during SSR.
     */
    initialThemeId: string | null;
}

/**
 * Interactive header controls component.
 *
 * Provides client-side interactive features for the main header:
 * - Theme toggle buttons rendered immediately with SSR data
 * - Wallet connection button via WalletButton from modules/user
 */
export function MainHeaderControls({ initialThemes, initialThemeId }: MainHeaderControlsProps) {
    return (
        <div className={styles.controls}>
            <ThemeToggle initialThemes={initialThemes} initialThemeId={initialThemeId} />
            <WalletButton />
        </div>
    );
}
