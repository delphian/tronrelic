'use client';

/**
 * @fileoverview /system/address-tags — admin management surface for the
 * address-tags module.
 *
 * Admin-gated by the /system layout; like the other system pages it is a
 * client component that fetches over the cookie-authenticated admin API (the
 * backend `requireAdmin` middleware is the trust boundary). All behaviour
 * lives in the AddressTagsManager component; this file is only the page
 * shell.
 */

import { Page, PageHeader } from '../../../../components/layout';
import { AddressTagsManager } from './AddressTagsManager';

/**
 * Page shell for the address-tag management table.
 */
export default function AddressTagsAdminPage() {
    return (
        <Page>
            <PageHeader
                title="Address Tags"
                subtitle="Create, rename, and remove text tags attached to TRON wallet addresses."
            />
            <AddressTagsManager />
        </Page>
    );
}
