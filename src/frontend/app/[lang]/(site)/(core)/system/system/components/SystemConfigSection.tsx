'use client';

/**
 * @fileoverview Site URL panel on the Configuration tab.
 *
 * The site URL is the public origin used for sharing previews and absolute
 * links. It is runtime configuration stored in MongoDB, so it is edited here
 * rather than in an environment file. The panel has the same header and Save
 * placement as the other panels on the tab.
 */

import { useCallback, useEffect, useState } from 'react';
import { Save, AlertCircle } from 'lucide-react';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Button } from '../../../../../../../components/ui/Button';
import { Field } from '../../../../../../../components/ui/Field';
import { Input } from '../../../../../../../components/ui/Input';
import { useToast } from '../../../../../../../components/ui/ToastProvider/ToastProvider';
import styles from './ProviderSection.module.scss';

/** The fields of the shared system config document this panel sends. */
interface ISystemConfigPayload {
    siteUrl?: string;
}

/**
 * Site URL configuration panel.
 *
 * Mounts only while the Configuration tab is active, so the fetch is deferred
 * until the admin opens it. The save is a PATCH that sends only `siteUrl`, so
 * it cannot overwrite the other fields stored on the same document, such as
 * the log settings edited from the logs page or the emit buffer values.
 *
 * @returns The panel.
 */
export function SystemConfigSection() {
    const [siteUrl, setSiteUrl] = useState('');
    const [originalSiteUrl, setOriginalSiteUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { push: pushToast } = useToast();

    /**
     * Load the stored site URL, reporting a failure both in the panel and as a
     * toast so the admin knows the empty field is not the stored value.
     */
    const fetchConfig = useCallback(async () => {
        // SystemAuthGate guarantees an admin session at this depth; the
        // same-origin Better Auth cookie authorizes the request.
        try {
            setError(null);
            const response = await fetch(`/api/admin/system/config/system`);
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
    }, [pushToast]);

    useEffect(() => {
        void fetchConfig();
    }, [fetchConfig]);

    /**
     * Save the edited site URL and adopt whatever the backend stored, since it
     * is the authority on the value written.
     */
    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const payload: ISystemConfigPayload = { siteUrl };
            const response = await fetch(`/api/admin/system/config/system`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
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
        <Panel
            title="Site URL"
            actions={(
                <Button
                    variant="primary"
                    onClick={() => void handleSave()}
                    disabled={!dirty || loading || saving}
                    loading={saving}
                    icon={<Save size={18} />}
                >
                    Save
                </Button>
            )}
        >
            {error && (
                <p className={styles.feedback_error} role="alert">
                    <AlertCircle size={16} aria-hidden="true" />
                    {error}
                </p>
            )}
            <div className={styles.field_grid}>
                <Field
                    className={styles.field_wide}
                    hint="Public origin for the site. Sharing previews and absolute links are built from it."
                >
                    <Input
                        id="system-site-url"
                        type="url"
                        value={siteUrl}
                        onChange={(event) => setSiteUrl(event.target.value)}
                        placeholder="https://tronrelic.com"
                        className={styles.mono}
                        disabled={loading || saving}
                        spellCheck={false}
                        aria-label="Site URL"
                    />
                </Field>
            </div>
        </Panel>
    );
}
