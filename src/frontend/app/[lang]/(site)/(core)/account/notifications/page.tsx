/**
 * @fileoverview Legacy `/account/notifications` route — permanent redirect to
 * `/profile`, the settings hub that owns the {@link PreferencesPanel}.
 *
 * Keeps bookmarks, in-app links, and external references to this URL working.
 * A server component so the redirect happens during SSR with no client flash.
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
