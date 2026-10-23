'use client';

/**
 * @fileoverview The translation editor for one managed content item, whatever
 * its type.
 *
 * Core manages translations for every translatable content type, so the editor
 * is core's too. It is built from the field list the type declares: one input
 * per translatable field, with the English value beside it. A content type's
 * admin page mounts it for one item — `/system/pages` opens it from a page's
 * Translations button — and keeps its own editor for the English original.
 *
 * An item is served in a language only while it has a published translation
 * into it, so this is also where an administrator opts an item into a
 * language. Only a signed-in admin may save; translations are not reviewed.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Archive, ArrowLeft, Edit, Eye, Plus, RotateCcw, Save, Sparkles, Trash2, X } from 'lucide-react';
import type {
    IContentTranslation,
    IContentTranslationSource,
    ILanguage,
    ITranslatableField,
    TranslationValues
} from '@/types';
import { localizePath } from '@/types';
import { Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Card } from '../../../../components/ui/Card';
import { Field } from '../../../../components/ui/Field';
import { Input } from '../../../../components/ui/Input';
import { Switch } from '../../../../components/ui/Switch';
import { Textarea } from '../../../../components/ui/Textarea';
import { useToast } from '../../../../components/ui/ToastProvider';
import { listLanguages, SuggestionSummary } from '../../../localization';
import {
    deleteTranslation,
    getTranslationOverview,
    restoreTranslation,
    saveTranslation,
    suggestTranslation
} from '../../api/client';
import styles from './ContentTranslations.module.scss';

/** Props for the translation editor. */
export interface ContentTranslationsProps {
    /** The managed content type, such as `core:page`. */
    typeId: string;
    /** Core content id of the item being translated. */
    contentId: string;
    /** The item's English title, shown in the headings. */
    title: string;
    /**
     * The English address the item is served at, so the editor can name the
     * translated address. Null when the item has no public address.
     */
    publicPath: string | null;
    /**
     * Renders a Markdown field's draft to HTML for the preview pane. Supplied
     * by a type whose Markdown is rendered in a way only it knows; leave it out
     * and the editor offers no preview.
     */
    renderPreview?: (markdown: string) => Promise<string>;
    /** Returns to the content type's own list. */
    onClose: () => void;
}

/** The translation open in the editor. */
interface ITranslationDraft {
    /** Language being edited. */
    language: ILanguage;
    /** Each field's value as its input holds it; list entries are joined with commas. */
    values: Record<string, string>;
    /** Whether visitors are served the translation once it is saved. */
    published: boolean;
    /** The stored translation, or null when this save will create it. */
    existing: IContentTranslation | null;
}

/**
 * Turn stored values into what the inputs hold. A list becomes one line with
 * its entries separated by commas.
 *
 * @param fields - The type's translatable fields.
 * @param values - Values keyed by field name.
 * @returns One string per field.
 */
function toInputValues(fields: ReadonlyArray<ITranslatableField>, values: TranslationValues): Record<string, string> {
    const inputs: Record<string, string> = {};
    for (const field of fields) {
        const value = values[field.name];
        inputs[field.name] = Array.isArray(value) ? value.join(', ') : (value ?? '');
    }

    return inputs;
}

/**
 * Turn what the inputs hold back into values to save. A list is split on
 * commas, with blank entries dropped.
 *
 * @param fields - The type's translatable fields.
 * @param inputs - One string per field.
 * @returns Values keyed by field name.
 */
function fromInputValues(fields: ReadonlyArray<ITranslatableField>, inputs: Record<string, string>): TranslationValues {
    const values: TranslationValues = {};
    for (const field of fields) {
        const text = inputs[field.name] ?? '';
        values[field.name] = field.kind === 'string-list'
            ? text.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
            : text;
    }

    return values;
}

/**
 * The values a new translation starts from: the English text, so the
 * translator has the same structure to replace, and an empty address field,
 * which means the English one is used.
 *
 * @param source - The English source.
 * @returns One input string per field.
 */
function startingValues(source: IContentTranslationSource): Record<string, string> {
    const inputs = toInputValues(source.fields, source.values);
    for (const field of source.fields) {
        if (field.kind === 'url') {
            inputs[field.name] = '';
        }
    }

    return inputs;
}

/**
 * Lists an item's translations by language and edits them.
 *
 * @param props - The item and the close handler.
 * @returns The language list, or the editor for one language.
 */
export function ContentTranslations({ typeId, contentId, title, publicPath, renderPreview, onClose }: ContentTranslationsProps) {
    const [languages, setLanguages] = useState<ILanguage[]>([]);
    const [translations, setTranslations] = useState<IContentTranslation[]>([]);
    const [source, setSource] = useState<IContentTranslationSource | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<ITranslationDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [preview, setPreview] = useState('');
    const { push } = useToast();
    // The language open in the editor now, read when a suggestion returns. A
    // request can take minutes, and its text must not land in another
    // language's editor if the administrator moved on meanwhile.
    const draftLanguageRef = useRef<string | null>(null);
    draftLanguageRef.current = draft?.language.code ?? null;

    const markdownField = source?.fields.find((field) => field.kind === 'markdown') ?? null;

    /**
     * Load the configured languages, the item's translations, and the English
     * text they follow together, so the list never shows one without the
     * others.
     */
    const load = useCallback(async () => {
        try {
            const [languageList, overview] = await Promise.all([
                listLanguages(),
                getTranslationOverview(typeId, contentId)
            ]);
            setLanguages(languageList);
            setTranslations(overview.translations);
            setSource(overview.source);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load translations');
        } finally {
            setLoading(false);
        }
    }, [typeId, contentId]);

    useEffect(
        /**
         * Load the list when the editor opens. It only appears after the
         * administrator asks for it, so this is a user-triggered load.
         */
        () => {
            void load();
        },
        [load]
    );

    useEffect(
        /**
         * Render a debounced preview of the Markdown field being edited,
         * through the renderer the content type supplied.
         *
         * @returns Cleanup that cancels a preview still waiting to run.
         */
        () => {
            let cleanup: (() => void) | undefined;
            if (showPreview && draft && markdownField && renderPreview) {
                const markdown = draft.values[markdownField.name] ?? '';
                /**
                 * Render the preview once typing has paused.
                 */
                const timeoutId = setTimeout(async () => {
                    try {
                        setPreview(await renderPreview(markdown));
                    } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to generate preview');
                    }
                }, 500);
                cleanup = () => clearTimeout(timeoutId);
            }

            return cleanup;
        },
        [showPreview, draft, markdownField, renderPreview]
    );

    /**
     * Open the editor for a language, starting from the stored translation or
     * from the English text when there is none yet.
     *
     * @param language - The language to edit.
     * @param existing - The stored translation, or null to create one.
     */
    const openEditor = (language: ILanguage, existing: IContentTranslation | null) => {
        if (!source) {
            return;
        }
        setDraft({
            language,
            existing,
            values: existing ? toInputValues(source.fields, existing.values) : startingValues(source),
            published: existing?.published ?? false
        });
        setShowPreview(false);
        setPreview('');
        setError(null);
    };

    /**
     * Change one field of the draft.
     *
     * @param name - The field name.
     * @param value - The input's new text.
     */
    const changeValue = (name: string, value: string) => {
        setDraft((current) => (current ? { ...current, values: { ...current.values, [name]: value } } : current));
    };

    /**
     * Ask the AI model to translate the item into the draft's language and
     * put its values in the fields, then show what it said and what it cost.
     *
     * Nothing is saved: the administrator reviews the text and saves it as
     * usual. Text already typed would be lost, so the administrator confirms
     * before it is replaced. The toast stays open when the model left notes,
     * because those are meant to be read before saving.
     */
    const suggestDraft = async () => {
        if (!draft || !source) {
            return;
        }
        const starting = draft.existing ? toInputValues(source.fields, draft.existing.values) : startingValues(source);
        const edited = source.fields.some((field) => draft.values[field.name] !== starting[field.name]);
        if (edited && !confirm('Replace the text in the editor with an AI suggestion?')) {
            return;
        }
        const requestLanguage = draft.language.code;
        setSuggesting(true);
        try {
            const result = await suggestTranslation(typeId, contentId, requestLanguage);
            if (draftLanguageRef.current === requestLanguage) {
                setDraft((current) => (current ? { ...current, values: toInputValues(source.fields, result.values) } : current));
                push({
                    tone: 'success',
                    title: 'Suggested a translation — review, then save',
                    description: (
                        <SuggestionSummary
                            notes={result.notes}
                            costUsd={result.costUsd}
                            model={result.model}
                            usage={result.usage}
                        />
                    ),
                    duration: result.notes !== null ? 0 : undefined
                });
            } else {
                push({ tone: 'warning', title: 'Suggestion discarded', description: 'The editor closed or changed language while the request was running.' });
            }
        } catch (err) {
            push({ tone: 'danger', title: 'Could not suggest a translation', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setSuggesting(false);
        }
    };

    /**
     * Save the draft. It is live as soon as it is saved, if it is published.
     */
    const saveDraft = async () => {
        if (!draft || !source) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await saveTranslation(typeId, contentId, draft.language.code, {
                values: fromInputValues(source.fields, draft.values),
                published: draft.published
            });
            setDraft(null);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save translation');
        } finally {
            setSaving(false);
        }
    };

    /**
     * Soft-delete or restore a translation, then reload the list.
     *
     * @param language - The translation's language code.
     * @param action - Which change to make.
     */
    const changeDeletion = async (language: string, action: 'delete' | 'restore') => {
        if (action === 'delete' && !confirm('Delete this translation? It stops being served in this language. You can restore it later.')) {
            return;
        }
        try {
            if (action === 'delete') {
                await deleteTranslation(typeId, contentId, language);
            } else {
                await restoreTranslation(typeId, contentId, language);
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to ${action} translation`);
        }
    };

    /**
     * Render the input for one field, chosen by its kind.
     *
     * @param field - The field.
     * @param value - The draft's text for it.
     * @param language - The draft's language, named in the accessible label.
     * @returns The control.
     */
    const renderControl = (field: ITranslatableField, value: string, language: ILanguage) => {
        const id = `translation-${field.name}`;
        const label = `${field.label} (${language.name})`;
        let control: ReactNode;
        if (field.kind === 'markdown' || field.kind === 'multiline') {
            control = (
                <Textarea
                    id={id}
                    className={field.kind === 'markdown' ? styles.markdown : undefined}
                    rows={field.kind === 'markdown' ? undefined : 3}
                    value={value}
                    onChange={(event) => changeValue(field.name, event.target.value)}
                    aria-label={label}
                    spellCheck={false}
                />
            );
        } else {
            control = (
                <Input
                    id={id}
                    value={value}
                    onChange={(event) => changeValue(field.name, event.target.value)}
                    aria-label={label}
                />
            );
        }

        return control;
    };

    /**
     * Render the English side of one field, or the preview in place of the
     * Markdown field's English text when the preview is on.
     *
     * @param field - The field.
     * @returns The read-only English value.
     */
    const renderEnglish = (field: ITranslatableField) => {
        const value = toInputValues([field], source?.values ?? {})[field.name];
        let english: ReactNode;
        if (showPreview && field.kind === 'markdown') {
            english = <div className={styles.preview} dangerouslySetInnerHTML={{ __html: preview }} />;
        } else if (field.kind === 'markdown' || field.kind === 'multiline') {
            english = (
                <Textarea
                    className={field.kind === 'markdown' ? styles.markdown : undefined}
                    rows={field.kind === 'markdown' ? undefined : 3}
                    value={value}
                    readOnly
                    aria-label={`English ${field.label.toLowerCase()}`}
                    spellCheck={false}
                />
            );
        } else {
            english = <Input value={value} readOnly aria-label={`English ${field.label.toLowerCase()}`} />;
        }

        return english;
    };

    const errorCard = error && (
        <Card tone="muted" padding="md">
            <p className={styles.error}>{error}</p>
        </Card>
    );

    if (draft && source) {
        const translatedPath = publicPath ? localizePath(publicPath, draft.language.code) : null;
        return (
            <div className={styles.container}>
                <Card padding="md">
                    <div className={styles.header}>
                        <h2 className={styles.title}>
                            {draft.existing ? 'Edit' : 'Translate'}: {title} → {draft.language.name}
                        </h2>
                        <div className={styles.actions}>
                            <span className={styles.published}>
                                <Switch
                                    on={draft.published}
                                    onChange={(next) => setDraft((current) => (current ? { ...current, published: next } : current))}
                                    aria-label="Published"
                                />
                                Published
                            </span>
                            <Button
                                variant="ghost"
                                size="md"
                                icon={<Sparkles size={18} />}
                                onClick={() => void suggestDraft()}
                                loading={suggesting}
                                disabled={saving}
                            >
                                Suggest
                            </Button>
                            {markdownField && renderPreview && (
                                <Button
                                    variant="ghost"
                                    size="md"
                                    icon={<Eye size={18} />}
                                    onClick={() => setShowPreview(!showPreview)}
                                >
                                    {showPreview ? 'Show English' : 'Show Preview'}
                                </Button>
                            )}
                            <Button
                                variant="secondary"
                                size="md"
                                icon={<X size={18} />}
                                onClick={() => setDraft(null)}
                                disabled={saving}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                size="md"
                                icon={<Save size={18} />}
                                onClick={() => void saveDraft()}
                                loading={saving}
                                disabled={suggesting}
                            >
                                Save
                            </Button>
                        </div>
                    </div>
                    {translatedPath && (
                        <p className={styles.row_meta}>
                            Served at <code>{translatedPath}</code> while published and the language is enabled.
                        </p>
                    )}
                </Card>

                {errorCard}

                {draft.existing?.stale && (
                    <Card tone="muted" padding="sm">
                        <p className={styles.notice}>
                            The English text has changed since this translation was saved. Saving records the
                            translation as matching the current English text.
                        </p>
                    </Card>
                )}

                {source.pendingEdit && (
                    <Card tone="muted" padding="sm">
                        <p className={styles.notice}>
                            An English edit is awaiting review. Translate the English text shown here; once the
                            edit is approved, this translation will be marked stale so you can update it.
                        </p>
                    </Card>
                )}

                <Card padding="md">
                    <Stack gap="lg">
                        {source.fields.map((field) => (
                            <div key={field.name} className={styles.field_row}>
                                <div className={styles.field_side}>
                                    <span className={styles.side_label}>
                                        {showPreview && field.kind === 'markdown' ? 'Preview' : 'English'}
                                    </span>
                                    {renderEnglish(field)}
                                </div>
                                <div className={styles.field_side}>
                                    <Field
                                        label={`${field.label}${field.required ? '' : ' (optional)'}`}
                                        htmlFor={`translation-${field.name}`}
                                        hint={field.kind === 'string-list'
                                            ? 'Separate entries with commas.'
                                            : field.hint}
                                    >
                                        {renderControl(field, draft.values[field.name] ?? '', draft.language)}
                                    </Field>
                                </div>
                            </div>
                        ))}
                    </Stack>
                </Card>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <Card padding="md">
                <div className={styles.header}>
                    <h2 className={styles.title}>Translations: {title}</h2>
                    <div className={styles.actions}>
                        <Button variant="secondary" size="md" icon={<ArrowLeft size={18} />} onClick={onClose}>
                            Back
                        </Button>
                    </div>
                </div>
            </Card>

            {errorCard}

            <Card padding="md">
                {loading ? (
                    <p className="text-muted">Loading translations...</p>
                ) : languages.length === 0 ? (
                    <p className="text-muted">
                        No languages are configured. Add one in System → Localization before translating.
                    </p>
                ) : (
                    <ul className={styles.list}>
                        {languages.map((language) => {
                            const translation = translations.find((candidate) => candidate.language === language.code) ?? null;
                            const translatedPath = publicPath ? localizePath(publicPath, language.code) : null;
                            return (
                                <li key={language.code} className={styles.row}>
                                    <Stack gap="sm">
                                        <div className={styles.row_header}>
                                            <span className={styles.language_name}>
                                                {language.name} <span className="text-muted">({language.nativeName})</span>
                                            </span>
                                            {!translation && <Badge tone="neutral">Not translated</Badge>}
                                            {translation && !translation.deletedAt && (
                                                <Badge tone={translation.published ? 'success' : 'neutral'}>
                                                    {translation.published ? 'Published' : 'Draft'}
                                                </Badge>
                                            )}
                                            {translation?.stale && !translation.deletedAt && (
                                                <Badge tone="warning"><AlertCircle size={12} /> English changed</Badge>
                                            )}
                                            {translation?.deletedAt && (
                                                <Badge tone="neutral"><Archive size={12} /> Deleted</Badge>
                                            )}
                                            {!language.enabled && <Badge tone="neutral">Language disabled</Badge>}
                                        </div>
                                        <p className={styles.row_meta}>
                                            {translation && translatedPath
                                                ? `Served at ${translatedPath} while published${language.enabled ? '' : ' and the language is enabled'}.`
                                                : translation
                                                    ? 'Served in this language while published.'
                                                    : 'Not served in this language.'}
                                        </p>
                                    </Stack>
                                    <div className={styles.actions}>
                                        {!translation && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                icon={<Plus size={16} />}
                                                onClick={() => openEditor(language, null)}
                                            >
                                                Translate
                                            </Button>
                                        )}
                                        {translation && !translation.deletedAt && (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    icon={<Edit size={16} />}
                                                    onClick={() => openEditor(language, translation)}
                                                >
                                                    Edit
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    icon={<Trash2 size={16} />}
                                                    onClick={() => void changeDeletion(language.code, 'delete')}
                                                >
                                                    Delete
                                                </Button>
                                            </>
                                        )}
                                        {translation?.deletedAt && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                icon={<RotateCcw size={16} />}
                                                onClick={() => void changeDeletion(language.code, 'restore')}
                                            >
                                                Restore
                                            </Button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Card>
        </div>
    );
}
