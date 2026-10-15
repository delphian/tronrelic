/**
 * @fileoverview Legacy `/account/notifications` route — permanent redirect to
 * `/profile`.
 *
 * Notification preferences moved into the consolidated profile settings hub.
 * This stub preserves any bookmarks, in-app links, or external references to
 * the old URL by redirecting them to the hub, which now owns the
 * {@link PreferencesPanel}. A server component so the redirect happens during
 * SSR with no client flash.
 */

import { redirect } from 'next/navigation';

/**
 * Redirect visitors of the retired notifications route to the profile hub.
 *
 * @returns Never — {@link redirect} throws to perform the navigation.
 */
export default function AccountNotificationsPage(): never {
    redirect('/profile');
}
