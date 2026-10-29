'use client';

/**
 * @fileoverview Settings tab of `/system/localization`.
 *
 * Holds what the AI translation buttons on the Translations tab send with
 * every request: the system prompt, where an administrator keeps the site's
 * tone and glossary, and the provider and model that run the request. Keeping
 * them here rather than asking on each click means every suggestion follows
 * the same terms and runs on a model the administrator chose deliberately.
 *
 * The model list comes from the AI Tools module's provider listing, which
 * spans every installed provider, so a model can be pinned on a provider that
 * is not the active one. Fetches its own data on mount, as every `/system`
 * manager does.
 *
 * @module modules/localization/components/admin/SettingsTab
 */

import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { ILocalizationSettings } from '@/types';
import { Panel } from '../../../../components/ui/Panel';
import { Button } from '../../../../components/ui/Button';
import { Textarea } from '../../../../components/ui/Textarea';
import { Field } from '../../../../components/ui/Field';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { useToast } from '../../../../components/ui/ToastProvider';
import {
    AiModelSelect,
    getQueryProviders,
    isSameAiModelChoice,
    type IAiModelChoice,
    type IAiProviderModels
} from '../../../ai-tools';
import { getLocalizationSettings, updateLocalizationSettings } from '../../api/client';
import styles from './LocalizationAdmin.module.scss';

/** Rows the system prompt editor shows; a glossary needs room. */
const PROMPT_ROWS = 12;

/** The automatic choice: the active provider with its default model. */
const AUTOMATIC_CHOICE: IAiModelChoice = { providerId: null, model: null };

/**
 * The Settings tab: system prompt and model choice for the AI translation
 * buttons.
 *
 * @returns The tab content.
 */
export function SettingsTab() {
    const [settings, setSettings] = useState<ILocalizationSettings | null>(null);
    const [providers, setProviders] = useState<IAiProviderModels[]>([]);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [modelChoice, setModelChoice] = useState<IAiModelChoice>(AUTOMATIC_CHOICE);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    /**
     * Load the saved settings and the installed providers' models. The
     * provider list failing must not hide the settings, so it degrades to an
     * empty list on its own.
     */
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [nextSettings, nextProviders] = await Promise.all([
                getLocalizationSettings(),
                getQueryProviders().catch(() => [] as IAiProviderModels[])
            ]);
            setSettings(nextSettings);
            setProviders(nextProviders);
            setSystemPrompt(nextSettings.systemPrompt);
            setModelChoice({ providerId: nextSettings.providerId, model: nextSettings.model });
        } catch (error) {
            push({ tone: 'danger', title: 'Could not load settings', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setLoading(false);
        }
    }, [push]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Save the prompt and model choice together, since the form edits both.
     */
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            const next = await updateLocalizationSettings({ systemPrompt, ...modelChoice });
            setSettings(next);
            setSystemPrompt(next.systemPrompt);
            setModelChoice({ providerId: next.providerId, model: next.model });
            push({ tone: 'success', title: 'Localization settings saved' });
        } catch (error) {
            push({ tone: 'danger', title: 'Could not save settings', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setSaving(false);
        }
    }, [modelChoice, push, systemPrompt]);

    const dirty = settings !== null && (
        systemPrompt !== settings.systemPrompt
        || !isSameAiModelChoice(modelChoice, { providerId: settings.providerId, model: settings.model })
    );

    // Save sits in the panel header, beside the "Saved 2h ago" line it updates,
    // rather than on a line of its own under a twelve-row editor.
    return (
        <Panel
            title="AI translation"
            meta={settings?.updatedAt ? <>Saved <ClientTime date={settings.updatedAt} format="relative" /></> : 'Using defaults'}
            actions={settings && (
                <Button
                    size="sm"
                    variant="primary"
                    loading={saving}
                    disabled={!dirty || systemPrompt.trim() === ''}
                    onClick={() => void handleSave()}
                    icon={<Save size={16} />}
                >
                    Save settings
                </Button>
            )}
        >
            {loading || !settings ? (
                <div className={styles.placeholder}>Loading settings…</div>
            ) : (
                <>
                    <Field
                        label="Model"
                        htmlFor="localization-model"
                        className={styles.model_field}
                        hint={providers.length === 0
                            ? 'No AI provider is installed. Enable an AI provider plugin to use translation suggestions.'
                            : undefined}
                    >
                        <AiModelSelect
                            id="localization-model"
                            providers={providers}
                            value={modelChoice}
                            onChange={setModelChoice}
                        />
                    </Field>
                    <Field
                        label="System prompt"
                        htmlFor="localization-system-prompt"
                        hint="Sent ahead of every Suggest request on the Translations tab, whatever the language. Put the site's tone and rules that hold in every language here. A glossary for one language, such as: TRON is always 波场, belongs in that language's translation prompt on the Languages tab. Suggestions fill the editors; nothing is saved until you save the row."
                    >
                        <Textarea
                            id="localization-system-prompt"
                            size="sm"
                            rows={PROMPT_ROWS}
                            value={systemPrompt}
                            onChange={event => setSystemPrompt(event.target.value)}
                        />
                    </Field>
                </>
            )}
        </Panel>
    );
}
