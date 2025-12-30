'use client';

import { useSystemAuth } from '../../../../features/system';
import { UsersMonitor } from '../../../../modules/user';

/**
 * System users management page.
 *
 * Thin wrapper that delegates to UsersMonitor from the user module.
 * Displays user identities with their linked wallets, preferences, and activity.
 * Requires admin authentication.
 */
export default function SystemUsersPage() {
    const { token } = useSystemAuth();

    return <UsersMonitor token={token} />;
}
