/**
 * @fileoverview Admin API call for the Bootstrap tab of `/system/tools`.
 *
 * The tab lists the CMS pages the tools module ships and lets an admin create
 * each one for curator review. This call runs in the browser with the
 * admin's session cookie; the server entry reads the first list itself so the
 * tab renders with data.
 */

import { isAxiosError } from 'axios';
import type { IPageBootstrapRow } from '@/types';
import { apiClient } from '../../../lib/api';

/**
 * Turn a failed bootstrap call into the message the admin should read,
 * preferring the backend's own explanation, which says which page holds the
 * address or why the content service refused.
 *
 * @param error - What the call threw.
 * @returns The message to show.
 */
function bootstrapErrorMessage(error: unknown): string {
    let message = error instanceof Error ? error.message : 'The request failed.';
    if (isAxiosError<{ message?: string; error?: string }>(error)) {
        message = error.response?.data?.message || error.response?.data?.error || 'The request failed.';
    }

    return message;
}

/**
 * Create one bootstrap page; the backend proposes it into the curation queue.
 *
 * Shaped as the `onCreate` the shared Bootstrap panel calls, so a refusal
 * reaches the panel as an `Error` carrying the backend's message.
 *
 * @param id - The bootstrap entry to create.
 * @returns The entry's updated row.
 * @throws Error with the backend's explanation when the create is refused,
 *   such as when a page already holds the address.
 */
export async function createBootstrapPage(id: string): Promise<IPageBootstrapRow> {
    let row: IPageBootstrapRow;
    try {
        const response = await apiClient.post(`/admin/tools/bootstrap/${encodeURIComponent(id)}`);
        row = response.data.page as IPageBootstrapRow;
    } catch (error) {
        throw new Error(bootstrapErrorMessage(error));
    }

    return row;
}
