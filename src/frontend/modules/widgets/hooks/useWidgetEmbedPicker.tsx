'use client';

/**
 * @fileoverview Opens the Insert widget dialog and resolves with the block.
 *
 * The page editor and, through the plugin context, the blog post editor both
 * need the same dialog. This hook wraps the modal provider so a caller can
 * `await pick()` and insert whatever comes back, with null meaning the author
 * cancelled.
 */

import { useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { IWidgetEmbedPickerClient } from '@/types';
import { useModal } from '../../../components/ui/ModalProvider';

/**
 * The dialog body, loaded only when the dialog opens. Plugin contexts carry
 * this hook on every page, and the settings form behind it is admin-only
 * code that would otherwise ship to every visitor.
 */
const WidgetEmbedPicker = dynamic(
    () => import('../components/WidgetEmbedPicker').then(mod => mod.WidgetEmbedPicker),
    { ssr: false }
);

/**
 * Get a client that opens the Insert widget dialog.
 *
 * @returns `pick()`, which resolves with the markdown block to insert, or
 *   null when the author closes the dialog without inserting.
 */
export function useWidgetEmbedPicker(): IWidgetEmbedPickerClient {
    const modal = useModal();

    /** Open the dialog and settle once with the block or null. */
    const pick = useCallback(() => new Promise<string | null>(resolve => {
        let settled = false;
        let modalId = '';

        /** Resolve once and close, whichever way the dialog ends. */
        const finish = (block: string | null) => {
            if (!settled) {
                settled = true;
                resolve(block);
                modal.close(modalId);
            }
        };

        modalId = modal.open({
            title: 'Insert widget',
            size: 'lg',
            content: <WidgetEmbedPicker onInsert={finish} onCancel={() => finish(null)} />,
            onClose: () => finish(null)
        });
    }), [modal]);

    return useMemo(() => ({ pick }), [pick]);
}
