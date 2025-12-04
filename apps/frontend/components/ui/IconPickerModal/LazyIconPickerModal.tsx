'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { IconPickerModalProps } from './IconPickerModal';
import styles from './LazyIconPickerModal.module.css';

/**
 * Loading placeholder displayed while the icon library downloads.
 */
function IconPickerLoading() {
    return (
        <div className={styles.loading}>
            <Loader2 size={32} className={styles.spinner} />
            <p className={styles.text}>Loading icon library...</p>
        </div>
    );
}

/**
 * Lazy-loaded IconPickerModal inner component.
 * The full icon library (~568KB uncompressed) is only loaded when rendered.
 */
const LazyIconPickerModalInner = dynamic(
    () => import('./IconPickerModal').then(mod => mod.IconPickerModal),
    { ssr: false }
);

/**
 * Lazy-loaded IconPickerModal with Suspense wrapper.
 *
 * Avoids bundling all 1,637 Lucide icons with the main application.
 * The icon library only downloads when a user actually opens the icon picker.
 * Shows a loading spinner while the chunk downloads.
 */
export function LazyIconPickerModal(props: IconPickerModalProps) {
    return (
        <Suspense fallback={<IconPickerLoading />}>
            <LazyIconPickerModalInner {...props} />
        </Suspense>
    );
}
