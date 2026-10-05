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
import { Input } from '../../../../../components/ui/Input';
import { Textarea } from '../../../../../components/ui/Textarea';
import { Field } from '../../../../../components/ui/Field';
import { Panel } from '../../../../../components/ui/Panel';
import { FigureList } from '../../../../../components/ui/FigureList';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { AboutDetails } from '../AboutDetails';
import {
    adminGetGscStatus,
    adminSaveGscCredentials,
    adminRemoveGscCredentials,
    adminRefreshGscData
} from '../../../api/client';
import type { IGscStatus } from '../../../api/client';
import styles from './GscSettings.module.scss';

/**
 * Admin panel for configuring Google Search Console integration.
 *
 * Displays connection status, provides a form for entering service
 * account credentials, and allows triggering manual data refreshes.
 * This component is an admin-only settings panel — no SSR data
 * fetching needed since admin pages fetch client-side after auth.
 */
export function GscSettings() {
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
            const result = await adminGetGscStatus();
            setStatus(result);
        } catch {
            setError('Failed to load GSC status');
        } finally {
            setLoading(false);
        }
    }, []);

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
            const result = await adminSaveGscCredentials(serviceAccountJson.trim(), siteUrl.trim());
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
    }, [serviceAccountJson, siteUrl]);

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
            await adminRemoveGscCredentials();
            setStatus({ configured: false });
            setSuccess('Credentials removed');
        } catch {
            setError('Failed to remove credentials');
        }
    }, [confirmingRemove]);

    /**
     * Trigger an on-demand GSC data fetch.
     */
    const handleRefresh = useCallback(async () => {
        setError(null);
        setSuccess(null);
        setRefreshing(true);

        try {
            const result = await adminRefreshGscData();
            setSuccess(`Fetched ${result.rowsFetched.toLocaleString()} rows from Search Console`);
            void fetchStatus();
        } catch {
            setError('Failed to refresh GSC data');
        } finally {
            setRefreshing(false);
        }
    }, [fetchStatus]);

    // Connection state rides in the panel header, so the panel's first line
    // answers "is this working" before anything else.
    const meta = loading ? 'Loading…' : (
        <span className={styles.status}>
            <span className={`${styles.status_dot} ${status?.configured ? styles['status_dot--connected'] : styles['status_dot--disconnected']}`} />
            {status?.configured ? 'Connected' : 'Not configured'}
        </span>
    );

    return (
        <Panel title="Google Search Console" meta={meta}>
            <div className={styles.body}>
                <AboutDetails summary="Why a service account is needed">
                    <p>
                        Google does not expose search keyword data directly &mdash; it lives behind
                        the Search Console API, which requires a service account for
                        server-to-server access. That means linking three things: a Google Cloud
                        project (owns the credentials), a Search Console property (owns the data),
                        and a service account that bridges the two. Once connected, keyword data
                        appears on the SEO tab and when you expand Google traffic sources on the
                        Analytics tab.
                    </p>
                </AboutDetails>

                {status?.configured && (
                    <FigureList
                        columns="single"
                        label="Search Console connection"
                        rows={[
                            { key: 'site', label: 'Site URL', value: status.siteUrl ?? '—' },
                            ...(status.lastFetch
                                ? [{ key: 'fetch', label: 'Last fetch', value: <ClientTime date={status.lastFetch} format="datetime" /> }]
                                : [])
                        ]}
                    />
                )}

                {error && <div className={styles.error} role="alert">{error}</div>}
                {success && <div className={styles.success} role="status">{success}</div>}

                {loading ? null : status?.configured ? (
                    <div className={styles.actions}>
                        <Button type="button" size="sm" onClick={handleRefresh} loading={refreshing}>
                            Refresh now
                        </Button>
                        <Button type="button" size="sm" variant="danger" onClick={handleRemove}>
                            {confirmingRemove ? 'Confirm remove' : 'Remove credentials'}
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
                            <h3 className={styles.setup_guide__title}>Quick setup</h3>
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
                                    site URL below, then select &ldquo;Test &amp; save&rdquo;.
                                    For domain properties use{' '}
                                    <code>sc-domain:example.com</code> format;
                                    for URL-prefix properties use{' '}
                                    <code>https://example.com</code>.
                                </li>
                            </ol>
                        </div>

                        <Field
                            label="Site URL"
                            htmlFor="gsc-site-url"
                            hint={(
                                <span className={styles.hint}>
                                    Must match exactly how your property appears in{' '}
                                    <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">
                                        Search Console
                                    </a>
                                    , including https://.
                                </span>
                            )}
                        >
                            <Input
                                id="gsc-site-url"
                                type="text"
                                size="sm"
                                value={siteUrl}
                                onChange={e => setSiteUrl(e.target.value)}
                                placeholder="sc-domain:example.com or https://example.com"
                            />
                        </Field>

                        <Field
                            label="Service account JSON key"
                            htmlFor="gsc-credentials"
                            hint="Paste the entire JSON key file. The key is stored in the database and is never exposed through the API."
                        >
                            <Textarea
                                id="gsc-credentials"
                                size="sm"
                                className={styles.textarea}
                                rows={5}
                                value={serviceAccountJson}
                                onChange={e => setServiceAccountJson(e.target.value)}
                                placeholder='{"type": "service_account", "project_id": "...", ...}'
                                spellCheck={false}
                            />
                        </Field>

                        <div className={styles.actions}>
                            <Button type="button" size="sm" onClick={handleSave} loading={saving}>
                                Test &amp; save
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </Panel>
    );
}
