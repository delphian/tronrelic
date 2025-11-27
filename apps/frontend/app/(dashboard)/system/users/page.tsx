'use client';

import { UsersMonitor, useSystemAuth } from '../../../../features/system';

/**
 * System users management page.
 *
 * Displays user identities with their linked wallets, preferences, and activity.
 * Provides search functionality by UUID or wallet address. Shows statistics
 * including total users, active users, and wallet linking metrics.
 * Requires admin authentication.
 */
export default function SystemUsersPage() {
    const { token } = useSystemAuth();

    return <UsersMonitor token={token} />;
}
