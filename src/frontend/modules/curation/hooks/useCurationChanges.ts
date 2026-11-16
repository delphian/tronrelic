/**
 * @fileoverview Loads the comparison between a pending curation item and the
 * live version of its content, for the review sheet.
 *
 * The comparison is loaded when the curator opens an item, not with the queue
 * list, because it carries both versions of the text. It is loaded again
 * whenever the queue is refetched, since an edit saved while the item is open
 * changes what the item would approve.
 */

import { useEffect, useState } from 'react';
import type { IContentChangeSet } from '@/types';
import { getCurationChanges } from '../api/client';

/** What the review sheet needs to show the comparison or explain its absence. */
export interface ICurationChangesState {
    /** The change set, or null when the type cannot compare, nothing has loaded yet, or a reload is in flight. */
    changes: IContentChangeSet | null;

    /** True while a request is in flight. */
    loading: boolean;

    /** The failure message when the request failed, otherwise null. */
    error: string | null;
}

/**
 * Load the change set for one pending item. A response for an item or
 * revision the caller has since moved past is dropped, so a slow request can
 * never show one item's changes on another.
 *
 * @param itemId - The pending curation envelope the curator has open.
 * @param revision - A number the caller increases each time it refetches the
 *   queue, which reloads the comparison for the same item.
 * @returns The change set and the request's state.
 */
export function useCurationChanges(itemId: string, revision: number): ICurationChangesState {
    const [state, setState] = useState<ICurationChangesState>({ changes: null, loading: true, error: null });

    /**
     * Fetch the comparison for the current item and revision, ignoring a
     * superseded response. The previous change set is dropped before the
     * request starts, because the review sheet leaves approval enabled while a
     * comparison loads, and an earlier revision's differences must never be
     * read as a description of the content about to be approved.
     */
    useEffect(() => {
        let current = true;
        setState({ changes: null, loading: true, error: null });
        getCurationChanges(itemId)
            .then((changes) => {
                if (current) {
                    setState({ changes, loading: false, error: null });
                }
            })
            .catch((err: unknown) => {
                if (current) {
                    setState({ changes: null, loading: false, error: err instanceof Error ? err.message : String(err) });
                }
            });
        return () => { current = false; };
    }, [itemId, revision]);

    return state;
}
