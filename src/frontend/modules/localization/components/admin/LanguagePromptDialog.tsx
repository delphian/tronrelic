'use client';

/**
 * @fileoverview Dialog that edits one language's translation prompt.
 *
 * A language's glossary and style rules, such as which crypto terms to
 * translate and how to address the reader, only make sense for that language.
 * Keeping them on the language means both Suggest features send them with
 * requests into it and with no other language's requests. The Languages tab
 * opens this dialog from each row.
 *
 * @module modules/localization/components/admin/LanguagePromptDialog
 */

import { useCallback, useState } from 'react';
import type { ILanguageSummary } from '@/types';
import { MAX_LANGUAGE_PROMPT_LENGTH } from '@/types';
import { Stack } from '../../../../components/layout';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { Textarea } from '../../../../components/ui/Textarea';
import { updateLanguage } from '../../api/client';
import styles from './LocalizationAdmin.module.scss';

/** Rows the editor shows; a glossary needs room. */
const PROMPT_ROWS = 14;

/** Props for {@link LanguagePromptDialog}. */
export interface ILanguagePromptDialogProps {
    /** The language whose prompt is edited, carrying the saved text to start from. */
    language: ILanguageSummary;
    /** Closes the dialog without saving. */
    onCancel: () => void;
    /** Called after a successful save, so the tab can reload and confirm it. */
    onSaved: () => void;
    /** Called with the error when the save fails, so the tab can show why. */
    onError: (error: unknown) => void;
}

/**
 * Edit and save the translation prompt for one language.
 *
 * The editor starts from the saved prompt, and Save stays disabled until the
 * text differs from it. Saving an empty prompt removes the language's
 * guidance, so requests into it use the shared system prompt alone.
 *
 * @param props - The language and the callbacks the tab supplies.
 * @returns The dialog body.
 */
export function LanguagePromptDialog({ language, onCancel, onSaved, onError }: ILanguagePromptDialogProps) {
    const [text, setText] = useState(language.translationPrompt);
    const [saving, setSaving] = useState(false);
    const fieldId = `localization-language-prompt-${language.code}`;
    const tooLong = text.trim().length > MAX_LANGUAGE_PROMPT_LENGTH;
    const dirty = text.trim() !== language.translationPrompt;

    /**
     * Save the prompt, then hand control back to the tab. Errors are passed
     * up rather than shown here, so the tab reports them in the same toast
     * style as its other actions.
     */
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            await updateLanguage(language.code, { translationPrompt: text });
            onSaved();
        } catch (error) {
            onError(error);
        } finally {
            setSaving(false);
        }
    }, [language.code, onError, onSaved, text]);

    return (
        <Stack gap="md">
            <Field
                label={`Translation prompt for ${language.name}`}
                htmlFor={fieldId}
                hint={`Added to the shared system prompt whenever a Suggest button translates into ${language.name}, for interface text and for pages alike. Put this language's glossary, register, and how to address the reader here. Leave it empty to use the shared prompt alone. ${text.trim().length}/${MAX_LANGUAGE_PROMPT_LENGTH} characters.`}
                error={tooLong ? `Shorten the prompt to ${MAX_LANGUAGE_PROMPT_LENGTH} characters or fewer.` : undefined}
            >
                <Textarea
                    id={fieldId}
                    size="sm"
                    rows={PROMPT_ROWS}
                    value={text}
                    invalid={tooLong}
                    onChange={event => setText(event.target.value)}
                />
            </Field>
            <div className={styles.dialog_actions}>
                <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    loading={saving}
                    disabled={!dirty || tooLong}
                    onClick={() => void handleSave()}
                >
                    Save prompt
                </Button>
            </div>
        </Stack>
    );
}
