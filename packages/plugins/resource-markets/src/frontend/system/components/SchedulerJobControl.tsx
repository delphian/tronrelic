'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';

/**
 * Scheduler Monitor interface from system feature.
 *
 * We import the SchedulerMonitor dynamically to avoid build-time dependencies
 * on the frontend app's system feature. This allows plugins to use the component
 * without creating circular dependencies or workspace boundary violations.
 */
interface SchedulerMonitorProps {
    token: string;
    jobFilter?: string[] | ((job: any) => boolean);
    sectionTitle?: string;
    hideHealth?: boolean;
}

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
 * 2. Dynamically imports SchedulerMonitor from the system feature
 * 3. Filters to show only the markets:refresh job
 * 4. Provides inline job control (enable/disable, schedule modification)
 *
 * **Security:**
 * Requires admin authentication. If no admin token is found in localStorage,
 * displays a message directing users to authenticate via /system first.
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context (currently unused, included for consistency)
 *
 * @example
 * ```tsx
 * <SchedulerJobControl context={context} />
 * ```
 */
export function SchedulerJobControl({ context }: { context: IFrontendPluginContext }) {
    const [SchedulerMonitor, setSchedulerMonitor] = useState<React.ComponentType<SchedulerMonitorProps> | null>(null);
    const [adminToken, setAdminToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    /**
     * Load admin token from localStorage and dynamically import SchedulerMonitor.
     *
     * Dynamic import prevents build-time dependency on system feature exports.
     * localStorage access is deferred to client-side to avoid SSR hydration mismatches.
     */
    useEffect(() => {
        async function loadSchedulerMonitor() {
            try {
                // Get admin token from localStorage (set by /system auth gate)
                const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
                setAdminToken(token);

                // Dynamically import SchedulerMonitor from system feature
                // @ts-ignore - Dynamic import resolved at runtime, not build time
                const systemModule = await import(
                    /* webpackChunkName: "system-scheduler-monitor" */
                    '../../../../../apps/frontend/features/system'
                );
                setSchedulerMonitor(() => systemModule.SchedulerMonitor);
            } catch (error) {
                console.error('Failed to load SchedulerMonitor:', error);
            } finally {
                setLoading(false);
            }
        }

        void loadSchedulerMonitor();
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

    if (!SchedulerMonitor) {
        return (
            <context.ui.Card>
                <h3 style={{ margin: '0 0 1rem 0' }}>Scheduler Job Control</h3>
                <p style={{ color: 'var(--color-error)' }}>
                    Failed to load scheduler monitoring component. Please try refreshing the page.
                </p>
            </context.ui.Card>
        );
    }

    return (
        <context.ui.Card>
            <SchedulerMonitor
                token={adminToken}
                jobFilter={['markets:refresh']}
                sectionTitle="Market Refresh Job"
                hideHealth={true}
            />
        </context.ui.Card>
    );
}
