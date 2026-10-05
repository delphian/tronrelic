/**
 * PanelBody Component
 *
 * The loading, error, and empty states every traffic panel needs, rendered in
 * one place so each panel only supplies its content.
 *
 * Each traffic dashboard used to carry its own copy of these three messages
 * with its own padding, so one tab showed a short line and the next a tall
 * centred block. This renders all three as one compact line in the same type,
 * and keeps the order fixed — error, then loading, then empty — so a panel
 * that missed a check cannot render a phantom table.
 */

import type { ReactNode } from 'react';
import styles from './PanelBody.module.scss';

interface IPanelBodyProps {
    /** True while the panel's first load is in flight. */
    loading: boolean;
    /** The load failure message, or null when the last load succeeded. */
    error: string | null;
    /** True when the load succeeded but returned nothing to show. */
    empty?: boolean;
    /** Message shown for the empty state. */
    emptyMessage?: ReactNode;
    /** The panel content, rendered only when none of the states apply. */
    children: ReactNode;
}

/**
 * Render the first state that applies, or the content.
 *
 * @param props - The three state flags, the empty message, and the content.
 * @returns The state message or the content.
 */
export function PanelBody({ loading, error, empty = false, emptyMessage = 'Nothing in this window.', children }: IPanelBodyProps) {
    let body: ReactNode = children;
    if (error) {
        body = <p className={styles.error} role="alert">{error}</p>;
    } else if (loading) {
        body = <p className={styles.message}>Loading…</p>;
    } else if (empty) {
        body = <p className={styles.message}>{emptyMessage}</p>;
    }
    return <>{body}</>;
}
