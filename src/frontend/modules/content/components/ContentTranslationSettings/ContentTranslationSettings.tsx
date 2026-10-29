'use client';

/**
 * @fileoverview The AI settings panel for content translation suggestions.
 *
 * Holds what every content translation Suggest request sends, whatever the
 * content type: the system prompt, where an administrator keeps the site's
 * tone and a glossary, and the provider and model that run the request. It
 * sits on the localization Settings tab next to the interface text settings,
 * and keeps its own values because articles and short interface strings
 * usually want different instructions and often a different model.
 */

import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { IContentTranslationSettings } from '@/types';
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
import { getTranslationSettings, updateTranslationSettings } from '../../api/client';
import styles from './ContentTranslationSettings.module.scss';

/** Rows the system prompt editor shows; a glossary needs room. */
const PROMPT_ROWS = 12;

/**
 * The model choice and system prompt for content translation suggestions.
 *
 * @returns The panel, or a short notice while the settings load.
 */
export function ContentTranslationSettings() {
    const [settings, setSettings] = useState<IContentTranslationSettings | null>(null);
    const [providers, setProviders] = useState<IAiProviderModels[]>([]);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [modelChoice, setModelChoice] = useState<IAiModelChoice>({ providerId: null, model: null });
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    /**
     * Put loaded or saved settings into the form.
     *
     * @param next - The settings to show.
     */
    const apply = useCallback((next: IContentTranslationSettings) => {
        setSettings(next);
        setSystemPrompt(next.systemPrompt);
        setModelChoice({ providerId: next.providerId, model: next.model });
    }, []);

    useEffect(
        /**
         * Load the settings and the installed providers' models when the tab
         * opens. A provider list that fails to load stays empty, which the
         * field's hint explains, rather than hiding the form.
         */
        () => {
            void getTranslationSettings()
                .then(apply)
                .catch((error) => push({
                    tone: 'danger',
                    title: 'Could not load content translation settings',
                    description: error instanceof Error ? error.message : String(error)
                }));
            void getQueryProviders()
                .catch(() => [] as IAiProviderModels[])
                .then(setProviders);
        },
        [apply, push]
    );

    /**
     * Save the prompt and model choice together, since the panel edits both.
     */
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            apply(await updateTranslationSettings({
                systemPrompt,
                providerId: modelChoice.providerId,
                model: modelChoice.model
            }));
            push({ tone: 'success', title: 'Content translation settings saved' });
        } catch (error) {
            push({ tone: 'danger', title: 'Could not save settings', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setSaving(false);
        }
    }, [apply, modelChoice, push, systemPrompt]);

    if (!settings) {
        return <p className="text-muted">Loading content translation settings...</p>;
    }

    const dirty = systemPrompt !== settings.systemPrompt
        || !isSameAiModelChoice(modelChoice, { providerId: settings.providerId, model: settings.model });

    return (
        <Panel
            title="Content translation"
            meta={settings.updatedAt
                ? <>Saved <ClientTime date={settings.updatedAt} format="relative" /></>
                : 'Using the defaults'}
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
                    htmlFor="content-translation-model"
                    className={styles.model_field}
                    hint={providers.length === 0
                        ? 'No AI provider is installed. Enable an AI provider plugin to use translation suggestions.'
                        : 'Runs the Suggest button in the translation editor of every content type, such as pages.'}
                >
                    <AiModelSelect
                        id="content-translation-model"
                        providers={providers}
                        value={modelChoice}
                        onChange={setModelChoice}
                    />
                </Field>
                <Field
                    label="System prompt"
                    htmlFor="content-translation-system-prompt"
                    hint="Sent ahead of every content translation Suggest request, whatever the language. Put the site's tone and rules that hold in every language here; a glossary for one language belongs in that language's translation prompt on the Languages tab. A suggestion fills the editor; nothing is saved until you save the translation."
                >
                    <Textarea
                        id="content-translation-system-prompt"
                        size="sm"
                        rows={PROMPT_ROWS}
                        value={systemPrompt}
                        onChange={(event) => setSystemPrompt(event.target.value)}
                    />
                </Field>
            </div>
        </Panel>
    );
}
