'use client';

/**
 * @fileoverview Settings tab of /system/pages: the route blacklist that keeps
 * custom page slugs from shadowing core URLs such as `/api` and `/system`.
 *
 * File-upload policy lives at /system/files, and the AI settings for
 * translation suggestions, which serve every content type, live on the
 * System → Localization Settings tab. The tab is one panel: the pattern count
 * and last change in its header, the patterns in a labelled field tall enough
 * to show them all, and Save directly under the field it saves.
 */

import { useState, useEffect, useCallback } from 'react';
import { Save } from 'lucide-react';
import type { IPageSettings } from '@/types';
import { Button } from '../../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import { Field } from '../../../../../../../components/ui/Field';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Textarea } from '../../../../../../../components/ui/Textarea';
import { useToast } from '../../../../../../../components/ui/ToastProvider';
import styles from './SettingsTab.module.scss';

/** Fewest rows the pattern field shows, so a short list still reads as a list. */
const MIN_ROWS = 6;

/** Most rows the pattern field grows to before it scrolls, about one screen of patterns. */
const MAX_ROWS = 24;

/**
 * Split the field's text into the patterns it holds, ignoring blank lines and
 * the spaces around each pattern, which is what the backend stores.
 *
 * @param text - The field's text, one pattern per line.
 * @returns The patterns.
 */
function toPatterns(text: string): string[] {
    return text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

/**
 * Size the pattern field to the lines it holds plus one for the next pattern,
 * within {@link MIN_ROWS} and {@link MAX_ROWS}, so the whole list shows
 * without an inner scroll until it is longer than a screen.
 *
 * @param text - The field's text.
 * @returns The number of rows to give the field.
 */
function rowsFor(text: string): number {
    return Math.min(MAX_ROWS, Math.max(MIN_ROWS, text.split('\n').length + 1));
}

/**
 * Pages settings tab: the route blacklist editor.
 *
 * @returns The tab.
 */
export function SettingsTab() {
    const [settings, setSettings] = useState<IPageSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [blacklistedRoutes, setBlacklistedRoutes] = useState('');
    const { push } = useToast();

    /** Load the stored settings into the field. */
    const fetchSettings = useCallback(async () => {
        try {
            const response = await fetch('/api/admin/pages/settings', {
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch settings: ${response.statusText}`);
            }

            const data: IPageSettings = await response.json();
            setSettings(data);
            setBlacklistedRoutes(data.blacklistedRoutes.join('\n'));
            setLoadError(null);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to fetch settings');
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Save the patterns. A refusal, such as a pattern that is not a valid
     * regular expression, is shown under the field it concerns; success is a
     * toast, so the panel does not shift.
     */
    const saveSettings = async () => {
        setSaving(true);
        setSaveError(null);

        try {
            const updates: Partial<IPageSettings> = {
                blacklistedRoutes: toPatterns(blacklistedRoutes)
            };

            const response = await fetch('/api/admin/pages/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || data.error || `Failed to save settings: ${response.statusText}`);
            }

            const updatedSettings: IPageSettings = await response.json();
            setSettings(updatedSettings);
            push({ tone: 'success', title: 'Route blacklist saved' });
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    /** Load the settings once the tab mounts. */
    useEffect(() => {
        void fetchSettings();
    }, [fetchSettings]);

    const count = settings?.blacklistedRoutes.length ?? 0;
    const meta = settings ? (
        <>
            {count} {count === 1 ? 'pattern' : 'patterns'} · updated <ClientTime date={settings.updatedAt} format="date" />
        </>
    ) : (loading ? 'Loading…' : undefined);

    return (
        <Panel title="Route blacklist" meta={meta}>
            {loadError && <div className="alert" role="alert">{loadError}</div>}
            <Field
                label="Blocked route patterns"
                hint="One regular expression per line. A custom page cannot take a slug that matches one, so it can never hide a system route such as /api or /system."
                error={saveError ?? undefined}
                className={styles.field}
            >
                <Textarea
                    className={styles.textarea}
                    value={blacklistedRoutes}
                    onChange={e => setBlacklistedRoutes(e.target.value)}
                    rows={rowsFor(blacklistedRoutes)}
                    invalid={saveError !== null}
                    disabled={!settings}
                    spellCheck={false}
                    placeholder={'^/api/.*\n^/system/.*'}
                />
            </Field>
            <Button
                variant="primary"
                icon={<Save size={16} />}
                onClick={() => void saveSettings()}
                loading={saving}
                disabled={!settings}
                className={styles.save}
            >
                Save
            </Button>
        </Panel>
    );
}
