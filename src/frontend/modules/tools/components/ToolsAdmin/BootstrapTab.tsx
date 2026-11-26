/**
 * @fileoverview The Bootstrap tab of `/system/tools`.
 *
 * Lists the CMS pages the tools module ships, such as the stake calculator's,
 * and creates each for curator review. The table, buttons, and toasts are the
 * shared `PageBootstrapPanel`, the same panel plugin admin pages use; this tab
 * only connects it to the tools module's admin route.
 */
'use client';

import type { IPageBootstrapRow } from '@/types';
import { PageBootstrapPanel } from '../../../pages';
import { createBootstrapPage } from '../../api/bootstrap';

/**
 * Props for {@link BootstrapTab}.
 */
interface IBootstrapTabProps {
    /**
     * The rows to list, seeded on the server so the tab opens with data and
     * held by the page shell so they survive a tab switch; null when the
     * server read failed.
     */
    pages: IPageBootstrapRow[] | null;
    /**
     * Hand a row the backend has just returned back to the shell, which owns
     * the rows so a created page is still shown as created after the admin
     * visits another tab.
     */
    onPageUpdated: (page: IPageBootstrapRow) => void;
}

/**
 * Bootstrap tab: the shared panel bound to `/api/admin/tools/bootstrap`.
 *
 * @param props - The rows to list and the callback that records an updated row.
 * @returns The tab panel.
 */
export function BootstrapTab({ pages, onPageUpdated }: IBootstrapTabProps) {
    return (
        <PageBootstrapPanel
            rows={pages}
            onRowUpdated={onPageUpdated}
            onCreate={createBootstrapPage}
            meta="Pages this module can create. Each goes to the curation queue and is created only while no page holds its address."
        />
    );
}
