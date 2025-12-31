'use client';

import { Page } from '../../../../components/layout';
import { ConfigurationPanel, useSystemAuth } from '../../../../features/system';
import { SystemHealthCards } from './SystemHealthCards';

/**
 * Configuration panel page.
 *
 * Displays runtime configuration settings including environment variables, feature flags,
 * and system parameters. Also displays system health metrics (Redis and Server status) at
 * the top of the page as compact cards. Provides detailed visibility into current application
 * configuration and infrastructure health without exposing sensitive credentials. Requires
 * admin authentication.
 */
export default function ConfigurationPage() {
    const { token } = useSystemAuth();

    return (
        <Page>
            <SystemHealthCards token={token} />
            <ConfigurationPanel token={token} />
        </Page>
    );
}
