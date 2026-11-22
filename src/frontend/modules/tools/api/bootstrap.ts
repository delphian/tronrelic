/**
 * @fileoverview Admin API calls for the Bootstrap tab of `/system/tools`.
 *
 * The tab lists the CMS pages the tools module ships and lets an admin create
 * each one for curator review. These calls run in the browser with the
 * admin's session cookie; the server entry reads the first list itself so the
 * tab renders with data.
 */

import { isAxiosError } from 'axios';
import type { IToolsBootstrapPage } from '@/types';
import { apiClient } from '../../../lib/api';

/**
 * Create one bootstrap page; the backend proposes it into the curation queue.
 *
 * @param id - The bootstrap entry to create.
 * @returns The entry's updated row and the curation item holding the page.
 * @throws When the backend refuses, such as when a page already holds the address.
 */
export async function createBootstrapPage(id: string): Promise<{ page: IToolsBootstrapPage; curationId: string }> {
    const response = await apiClient.post(`/admin/tools/bootstrap/${encodeURIComponent(id)}`);
    return { page: response.data.page as IToolsBootstrapPage, curationId: String(response.data.curationId) };
}

/**
 * Turn a failed bootstrap call into the message the admin should read,
 * preferring the backend's own explanation, which says which page holds the
 * address or why the content service refused.
 *
 * @param error - What the call threw.
 * @param fallback - The message to show when the backend gave none.
 * @returns The message to show.
 */
export function bootstrapErrorMessage(error: unknown, fallback: string): string {
    let message = error instanceof Error ? error.message : fallback;
    if (isAxiosError<{ message?: string; error?: string }>(error)) {
        message = error.response?.data?.message || error.response?.data?.error || fallback;
    }

    return message;
}
