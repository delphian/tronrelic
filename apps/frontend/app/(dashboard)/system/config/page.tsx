'use client';

import { ConfigurationPanel, useSystemAuth } from '../../../../features/system';

/**
 * Configuration panel page.
 *
 * Displays runtime configuration settings including environment variables, feature flags,
 * and system parameters. Provides detailed visibility into current application configuration
 * without exposing sensitive credentials. Requires admin authentication.
 */
export default function ConfigurationPage() {
    const { token } = useSystemAuth();

    return <ConfigurationPanel token={token} />;
}
