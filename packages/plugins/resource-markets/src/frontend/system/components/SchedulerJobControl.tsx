'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';

/**
 * Scheduler Job Control Component.
 *
 * Provides a plugin-scoped view of the scheduler job control interface,
 * specifically showing and managing the markets:refresh job that updates
 * energy market pricing data.
 *
 * **Why this component exists:**
 * - Plugins need isolated job control without affecting other system jobs
 * - Admin users should be able to manage plugin jobs from the plugin settings page
 * - Provides context about what the job does within the plugin's domain
 *
 * **How it works:**
 * 1. Retrieves admin token from localStorage (set by /system auth gate)
 * 2. Uses SchedulerMonitor from plugin context (dependency injection)
 * 3. Filters to show only the markets:refresh job
 * 4. Provides inline job control (enable/disable, schedule modification)
 *
 * **Security:**
 * Requires admin authentication. If no admin token is found in localStorage,
 * displays a message directing users to authenticate via /system first.
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with system components
 *
 * @example
 * ```tsx
 * <SchedulerJobControl context={context} />
 * ```
 */
export function SchedulerJobControl({ context }: { context: IFrontendPluginContext }) {
    const [adminToken, setAdminToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    /**
     * Load admin token from localStorage on client-side mount.
     *
     * localStorage access is deferred to client-side to avoid SSR hydration mismatches.
     */
    useEffect(() => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
        setAdminToken(token);
        setLoading(false);
    }, []);

    if (loading) {
        return (
            <context.ui.Card>
                <h3 style={{ margin: '0 0 1rem 0' }}>Scheduler Job Control</h3>
                <context.ui.Skeleton height="200px" />
            </context.ui.Card>
        );
    }

    if (!adminToken) {
        return (
            <context.ui.Card>
                <h3 style={{ margin: '0 0 1rem 0' }}>Scheduler Job Control</h3>
                <p style={{ marginBottom: '1rem' }}>
                    Admin authentication required to view and control scheduler jobs.
                </p>
                <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>
                    Please visit <a href="/system" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>/system</a> to authenticate first,
                    then return to this page.
                </p>
            </context.ui.Card>
        );
    }

    return (
        <context.ui.Card>
            <context.system.SchedulerMonitor
                token={adminToken}
                jobFilter={['markets:refresh']}
                sectionTitle="Market Refresh Job"
                hideHealth={true}
            />
        </context.ui.Card>
    );
}
