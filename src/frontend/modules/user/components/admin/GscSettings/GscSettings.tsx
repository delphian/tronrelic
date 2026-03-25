'use client';

/**
 * Google Search Console settings panel.
 *
 * Allows administrators to configure GSC service account credentials,
 * view connection status, and trigger manual data refreshes. Credentials
 * are stored in the database key-value store on the backend.
 */

import { useState, useEffect, useCallback } from 'react';
import { isAxiosError } from 'axios';
import { Button } from '../../../../../components/ui/Button';
import { Card } from '../../../../../components/ui/Card';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Stack } from '../../../../../components/layout';
import {
    adminGetGscStatus,
    adminSaveGscCredentials,
    adminRemoveGscCredentials,
    adminRefreshGscData
} from '../../../api/client';
import type { IGscStatus } from '../../../api/client';
import styles from './GscSettings.module.scss';

/**
 * Props for the GscSettings component.
 */
interface Props {
    /** Admin API token for authenticated requests */
    token: string;
}

/**
 * Admin panel for configuring Google Search Console integration.
 *
 * Displays connection status, provides a form for entering service
 * account credentials, and allows triggering manual data refreshes.
 * This component is an admin-only settings panel — no SSR data
 * fetching needed since admin pages fetch client-side after auth.
 *
 * @param props - Component props with admin token
 */
export function GscSettings({ token }: Props) {
    const [status, setStatus] = useState<IGscStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [serviceAccountJson, setServiceAccountJson] = useState('');
    const [siteUrl, setSiteUrl] = useState('');

    /**
     * Fetch current GSC configuration status from the backend.
     */
    const fetchStatus = useCallback(async () => {
        setError(null);
        setSuccess(null);
        try {
            const result = await adminGetGscStatus(token);
            setStatus(result);
        } catch {
            setError('Failed to load GSC status');
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        void fetchStatus();
    }, [fetchStatus]);

    /**
     * Save credentials after validation and API access test.
     */
    const handleSave = useCallback(async () => {
        if (!serviceAccountJson.trim() || !siteUrl.trim()) {
            setError('Both fields are required');
            return;
        }

        setError(null);
        setSuccess(null);
        setSaving(true);

        try {
            const result = await adminSaveGscCredentials(token, serviceAccountJson.trim(), siteUrl.trim());
            setStatus(result);
            setServiceAccountJson('');
            setSiteUrl('');
            setSuccess('Credentials saved and verified successfully');
        } catch (err: unknown) {
            let message = 'Failed to save credentials';
            if (isAxiosError<{ message?: string; error?: string }>(err)) {
                message = err.response?.data?.message || err.response?.data?.error || message;
            } else if (err instanceof Error) {
                message = err.message;
            }
            setError(message);
        } finally {
            setSaving(false);
        }
    }, [token, serviceAccountJson, siteUrl]);

    const [confirmingRemove, setConfirmingRemove] = useState(false);

    /**
     * Remove stored credentials after confirmation.
     */
    const handleRemove = useCallback(async () => {
        if (!confirmingRemove) {
            setConfirmingRemove(true);
            return;
        }

        setError(null);
        setSuccess(null);
        setConfirmingRemove(false);

        try {
            await adminRemoveGscCredentials(token);
            setStatus({ configured: false });
            setSuccess('Credentials removed');
        } catch {
            setError('Failed to remove credentials');
        }
    }, [token, confirmingRemove]);

    /**
     * Trigger an on-demand GSC data fetch.
     */
    const handleRefresh = useCallback(async () => {
        setError(null);
        setSuccess(null);
        setRefreshing(true);

        try {
            const result = await adminRefreshGscData(token);
            setSuccess(`Fetched ${result.rowsFetched.toLocaleString()} rows from Search Console`);
            void fetchStatus();
        } catch {
            setError('Failed to refresh GSC data');
        } finally {
            setRefreshing(false);
        }
    }, [token, fetchStatus]);

    if (loading) {
        return (
            <Card padding="lg">
                <p className="text-muted">Loading Search Console settings...</p>
            </Card>
        );
    }

    return (
        <div className={styles.container}>
            <Card padding="lg">
                <Stack gap="md">
                    <h3>Google Search Console</h3>
                    <p className="text-muted">
                        Google does not expose search keyword data directly &mdash; it
                        lives behind the Search Console API, which requires a service
                        account for server-to-server access. That means linking three
                        things: a Google Cloud project (owns the credentials), a Search
                        Console property (owns the data), and a service account that
                        bridges the two. Once connected, keyword data appears in the
                        analytics tab when you expand Google traffic sources.
                    </p>

                    <div className={styles.status}>
                        <span className={`${styles.status_dot} ${status?.configured ? styles['status_dot--connected'] : styles['status_dot--disconnected']}`} />
                        {status?.configured ? 'Connected' : 'Not configured'}
                    </div>

                    {status?.configured && (
                        <Stack gap="sm">
                            <div className={styles.info_row}>
                                <span className={styles.info_label}>Site URL</span>
                                <span className={styles.info_value}>{status.siteUrl}</span>
                            </div>
                            {status.lastFetch && (
                                <div className={styles.info_row}>
                                    <span className={styles.info_label}>Last fetch</span>
                                    <span className={styles.info_value}>
                                        <ClientTime date={status.lastFetch} format="datetime" />
                                    </span>
                                </div>
                            )}
                        </Stack>
                    )}

                    {error && <div className={styles.error}>{error}</div>}
                    {success && <div className={styles.success}>{success}</div>}

                    {status?.configured ? (
                        <div className={styles.actions}>
                            <Button type="button" size="sm" onClick={handleRefresh} loading={refreshing}>
                                Refresh Now
                            </Button>
                            <Button type="button" size="sm" variant="danger" onClick={handleRemove}>
                                {confirmingRemove ? 'Confirm Remove' : 'Remove Credentials'}
                            </Button>
                            {confirmingRemove && (
                                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>
                                    Cancel
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className={styles.form}>
                            <div className={styles.setup_guide}>
                                <h4 className={styles.setup_guide__title}>Quick Setup</h4>
                                <ol className={styles.setup_guide__steps}>
                                    <li>
                                        <strong>Verify your site</strong> in{' '}
                                        <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">
                                            Google Search Console
                                        </a>{' '}
                                        if you haven&rsquo;t already (DNS or HTML verification).
                                    </li>
                                    <li>
                                        <strong>Create a service account</strong> in a{' '}
                                        <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer">
                                            Google Cloud project
                                        </a>{' '}
                                        and download the JSON key file. No special
                                        GCP IAM roles are needed.
                                    </li>
                                    <li>
                                        <strong>Enable the API</strong> &mdash; in the same GCP project,
                                        go to{' '}
                                        <a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank" rel="noopener noreferrer">
                                            APIs &amp; Services
                                        </a>{' '}
                                        and enable the <em>Google Search Console API</em>.
                                    </li>
                                    <li>
                                        <strong>Grant access</strong> &mdash; back in Search Console,
                                        go to Settings &rarr; Users and permissions &rarr; Add user.
                                        Paste the service account email
                                        (ends in <code>@...iam.gserviceaccount.com</code>)
                                        with &ldquo;Full&rdquo; permission.
                                    </li>
                                    <li>
                                        <strong>Connect</strong> &mdash; paste the JSON key and your
                                        site URL below, then hit &ldquo;Test &amp; Save&rdquo;.
                                        For domain properties use{' '}
                                        <code>sc-domain:example.com</code> format;
                                        for URL-prefix properties use{' '}
                                        <code>https://example.com</code>.
                                    </li>
                                </ol>
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="gsc-site-url">
                                    Site URL
                                </label>
                                <input
                                    id="gsc-site-url"
                                    type="text"
                                    className={styles.input}
                                    value={siteUrl}
                                    onChange={e => setSiteUrl(e.target.value)}
                                    placeholder="sc-domain:example.com or https://example.com"
                                />
                                <span className={styles.hint}>
                                    Must match exactly how your property appears in{' '}
                                    <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">
                                        Search Console
                                    </a>{' '}
                                    (including https://).
                                </span>
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="gsc-credentials">
                                    Service Account JSON Key
                                </label>
                                <textarea
                                    id="gsc-credentials"
                                    className={styles.textarea}
                                    value={serviceAccountJson}
                                    onChange={e => setServiceAccountJson(e.target.value)}
                                    placeholder='{"type": "service_account", "project_id": "...", ...}'
                                    spellCheck={false}
                                />
                                <span className={styles.hint}>
                                    Paste the entire JSON key file. The key is stored securely in
                                    the database and is never exposed through the API.
                                </span>
                            </div>

                            <div className={styles.actions}>
                                <Button type="button" size="sm" onClick={handleSave} loading={saving}>
                                    Test & Save
                                </Button>
                            </div>
                        </div>
                    )}
                </Stack>
            </Card>
        </div>
    );
}
