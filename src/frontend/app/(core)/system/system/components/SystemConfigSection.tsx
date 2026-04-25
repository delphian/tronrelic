'use client';

import { useCallback, useEffect, useState } from 'react';
import { Save, AlertCircle } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Stack } from '../../../../../components/layout';
import { useToast } from '../../../../../components/ui/ToastProvider/ToastProvider';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import styles from './SystemConfigSection.module.scss';

interface Props {
    token: string;
}

interface SystemConfigPayload {
    siteUrl?: string;
}

/**
 * Site URL configuration body.
 *
 * Rendered inside a CollapsibleSection — this component only mounts when
 * the section is expanded, so the initial config fetch is deferred until
 * the admin actually opens the section. The save handler is intentionally
 * PATCH-only and sends just `siteUrl` so the other fields stored on the
 * same document (log retention, log level, etc., which are now edited
 * from the logs page) are not overwritten with stale values from this
 * form.
 */
export function SystemConfigSection({ token }: Props) {
    const [siteUrl, setSiteUrl] = useState('');
    const [originalSiteUrl, setOriginalSiteUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { push: pushToast } = useToast();
    const runtimeConfig = getRuntimeConfig();

    const fetchConfig = useCallback(async () => {
        // SystemAuthGate guarantees a non-empty token at this depth, so we
        // do not gate on token here — gating without resetting `loading`
        // would strand the form in a permanent disabled state.
        try {
            setError(null);
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/system/config/system`, {
                headers: { 'X-Admin-Token': token }
            });
            if (!response.ok) throw new Error(`Request failed: ${response.statusText}`);
            const data = await response.json();
            const value = data.config?.siteUrl ?? '';
            setSiteUrl(value);
            setOriginalSiteUrl(value);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            pushToast({
                tone: 'danger',
                title: 'Failed to load site configuration',
                description: message
            });
        } finally {
            setLoading(false);
        }
    }, [token, pushToast, runtimeConfig.apiUrl]);

    useEffect(() => {
        void fetchConfig();
    }, [fetchConfig]);

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const payload: SystemConfigPayload = { siteUrl };
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/system/config/system`, {
                method: 'PATCH',
                headers: {
                    'X-Admin-Token': token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.error || `Request failed: ${response.statusText}`);
            }
            const updated = data.config?.siteUrl ?? siteUrl;
            setOriginalSiteUrl(updated);
            setSiteUrl(updated);
            pushToast({
                tone: 'success',
                title: 'Site URL saved'
            });
        } catch (error) {
            pushToast({
                tone: 'danger',
                title: 'Failed to save',
                description: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            setSaving(false);
        }
    };

    const dirty = siteUrl !== originalSiteUrl;

    return (
        <Stack gap="md">
            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={16} aria-hidden="true" />
                        {error}
                    </span>
                </div>
            )}
            <label className={styles.field}>
                <span className={styles.field_label}>Site URL</span>
                <input
                    type="url"
                    value={siteUrl}
                    onChange={(event) => setSiteUrl(event.target.value)}
                    placeholder="https://tronrelic.com"
                    className={styles.input}
                    disabled={loading || saving}
                    spellCheck={false}
                />
                <span className={styles.field_hint}>
                    Public origin for the site. Affects sharing previews and absolute links.
                </span>
            </label>
            <div className={styles.actions}>
                <Button
                    variant="primary"
                    size="md"
                    onClick={() => void handleSave()}
                    disabled={!dirty || loading || saving}
                    loading={saving}
                    icon={<Save size={18} />}
                >
                    Save
                </Button>
            </div>
        </Stack>
    );
}
