'use client';

/**
 * @fileoverview /account/notifications — the per-user notification preferences
 * page. Any signed-in user manages their own opt-outs here; the shared
 * {@link PreferencesPanel} owns data loading and enforcement is server-side. A
 * client component because it is a personal settings surface, not public
 * primary content.
 */

import { Page, PageHeader } from '../../../../components/layout';
import { PreferencesPanel } from '../../../../modules/notifications';

/**
 * Per-user notification preferences page.
 *
 * @returns The page.
 */
export default function AccountNotificationsPage() {
    return (
        <Page>
            <PageHeader title="Notification Preferences" subtitle="Choose which notifications reach you, or mute them all." />
            <PreferencesPanel />
        </Page>
    );
}
