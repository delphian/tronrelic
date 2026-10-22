'use client';

/**
 * @fileoverview The AI translation panel of the Pages Settings tab.
 *
 * Holds what the Suggest button in the page translation editor sends with
 * every request: the system prompt, where an administrator keeps the site's
 * tone and glossary, and the provider and model that run the request. It
 * mirrors the localization Settings tab, and keeps its own values because page
 * articles and interface strings usually want different instructions and
 * often a different model.
 */

import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { IPageSettings } from '@/types';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Button } from '../../../../../../../components/ui/Button';
import { Textarea } from '../../../../../../../components/ui/Textarea';
import { Field } from '../../../../../../../components/ui/Field';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import { useToast } from '../../../../../../../components/ui/ToastProvider';
import {
    AiModelSelect,
    getQueryProviders,
    isSameAiModelChoice,
    type IAiModelChoice,
    type IAiProviderModels
} from '../../../../../../../modules/ai-tools';
import styles from './PageTranslationSettings.module.scss';

/** Rows the system prompt editor shows; a glossary needs room. */
const PROMPT_ROWS = 12;

/** Props for the AI translation panel. */
interface PageTranslationSettingsProps {
    /** The page settings as last loaded or saved. */
    settings: IPageSettings;
    /** Receives the settings after a successful save, so the tab stays current. */
    onSaved: (settings: IPageSettings) => void;
}

/**
 * The model choice and system prompt for page translation suggestions.
 *
 * @param props - The current settings and the save callback.
 * @returns The panel.
 */
export function PageTranslationSettings({ settings, onSaved }: PageTranslationSettingsProps) {
    const [providers, setProviders] = useState<IAiProviderModels[]>([]);
    const [systemPrompt, setSystemPrompt] = useState(settings.translationSystemPrompt);
    const [modelChoice, setModelChoice] = useState<IAiModelChoice>({
        providerId: settings.translationProviderId,
        model: settings.translationModel
    });
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    useEffect(
        /**
         * Load the installed providers' models once. A failure leaves the list
         * empty, which the field's hint explains, rather than hiding the form.
         */
        () => {
            void getQueryProviders()
                .catch(() => [] as IAiProviderModels[])
                .then(setProviders);
        },
        []
    );

    /**
     * Save the prompt and model choice together, since the panel edits both.
     */
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            const response = await fetch('/api/admin/pages/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    translationSystemPrompt: systemPrompt,
                    translationProviderId: modelChoice.providerId,
                    translationModel: modelChoice.model
                })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || `Failed to save settings: ${response.statusText}`);
            }
            const next: IPageSettings = await response.json();
            setSystemPrompt(next.translationSystemPrompt);
            setModelChoice({ providerId: next.translationProviderId, model: next.translationModel });
            onSaved(next);
            push({ tone: 'success', title: 'Page translation settings saved' });
        } catch (error) {
            push({ tone: 'danger', title: 'Could not save settings', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setSaving(false);
        }
    }, [modelChoice, onSaved, push, systemPrompt]);

    const dirty = systemPrompt !== settings.translationSystemPrompt
        || !isSameAiModelChoice(modelChoice, { providerId: settings.translationProviderId, model: settings.translationModel });

    return (
        <Panel
            title="AI translation"
            meta={<>Saved <ClientTime date={settings.updatedAt} format="relative" /></>}
            actions={(
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
            <div className={styles.form}>
                <Field
                    label="Model"
                    htmlFor="page-translation-model"
                    className={styles.model_field}
                    hint={providers.length === 0
                        ? 'No AI provider is installed. Enable an AI provider plugin to use page translation suggestions.'
                        : 'Runs the Suggest button in a page’s translation editor.'}
                >
                    <AiModelSelect
                        id="page-translation-model"
                        providers={providers}
                        value={modelChoice}
                        onChange={setModelChoice}
                    />
                </Field>
                <Field
                    label="System prompt"
                    htmlFor="page-translation-system-prompt"
                    hint="Sent ahead of every page translation Suggest request. Put the site's tone and a glossary here. A suggestion fills the editor; nothing is saved until you save the translation."
                >
                    <Textarea
                        id="page-translation-system-prompt"
                        size="sm"
                        rows={PROMPT_ROWS}
                        value={systemPrompt}
                        onChange={event => setSystemPrompt(event.target.value)}
                    />
                </Field>
            </div>
        </Panel>
    );
}
