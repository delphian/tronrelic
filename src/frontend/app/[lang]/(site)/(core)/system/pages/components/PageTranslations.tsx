'use client';

/**
 * @fileoverview Translation management for one CMS page on `/system/pages`.
 *
 * A page is served in a language only while it has a published translation
 * into it, so this panel is where an administrator opts a page into a language.
 * It lists every language configured on `/system/localization`, shows the state
 * of this page's translation into each, and opens a side-by-side editor with
 * the English markdown next to the translation.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../../../../../../../components/ui/Card';
import { useToast } from '../../../../../../../components/ui/ToastProvider';
import { SuggestionSummary } from '../../../../../../../modules/localization';
import { Button } from '../../../../../../../components/ui/Button';
import { Badge } from '../../../../../../../components/ui/Badge';
import { Textarea } from '../../../../../../../components/ui/Textarea';
import { Stack } from '../../../../../../../components/layout';
import { ArrowLeft, Save, X, Eye, Plus, Edit, Trash2, RotateCcw, Clock, XCircle, AlertCircle, Archive, Sparkles } from 'lucide-react';
import type { ILanguage, IPage, IPageTranslation, IPageTranslationSuggestionResult } from '@/types';
import { localizePath } from '@/types';
import styles from './PageTranslations.module.scss';

/** Props for the translations panel. */
interface PageTranslationsProps {
    /** The page whose translations are managed, at its latest edit. */
    page: IPage & { contentId: string };
    /** Returns to the page list. */
    onClose: () => void;
}

/** The translation open in the editor. */
interface ITranslationDraft {
    /** Language being edited. */
    language: ILanguage;
    /** Markdown in the editor. */
    content: string;
    /** The stored translation, or null when this save will create it. */
    existing: IPageTranslation | null;
}

/** Matches the frontmatter block at the top of a page's markdown. */
const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Build the starting markdown for a new translation.
 *
 * Starting from the English text gives the translator the same structure to
 * replace line by line. `published` starts false so saving a half-finished
 * translation never puts it live, and `slug` is left out because a
 * translation is always served at its page's slug.
 *
 * @param page - The English page being translated.
 * @returns Frontmatter carrying the English values, followed by the English body.
 */
function buildTranslationTemplate(page: IPage): string {
    const body = page.content.replace(FRONTMATTER_PATTERN, '');
    const lines = [
        '---',
        `title: ${JSON.stringify(page.title)}`,
        `description: ${JSON.stringify(page.description ?? '')}`,
        `keywords: ${JSON.stringify(page.keywords ?? [])}`,
        'published: false',
        `ogImage: ${JSON.stringify(page.ogImage ?? '')}`,
        '---',
        ''
    ];

    return `${lines.join('\n')}${body.replace(/^\r?\n/, '')}`;
}

/**
 * Read an error message out of a failed admin response.
 *
 * @param response - The failed response.
 * @param fallback - Used when the body carries no message.
 * @returns The message to show the administrator.
 */
async function readError(response: Response, fallback: string): Promise<string> {
    const data = await response.json().catch(() => ({}));

    return data.message || data.error || fallback;
}

/**
 * Lists a page's translations by language and edits them.
 *
 * @param props - The page and the close handler.
 * @returns The language list, or the editor for one language.
 */
export function PageTranslations({ page, onClose }: PageTranslationsProps) {
    const [languages, setLanguages] = useState<ILanguage[]>([]);
    const [translations, setTranslations] = useState<IPageTranslation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<ITranslationDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [preview, setPreview] = useState('');
    const [suggesting, setSuggesting] = useState(false);
    const { push } = useToast();
    // The language open in the editor now, read when a suggestion returns. A
    // request can take minutes, and its text must not land in another
    // language's editor if the administrator moved on meanwhile.
    const draftLanguageRef = useRef<string | null>(null);
    draftLanguageRef.current = draft?.language.code ?? null;

    const baseUrl = `/api/admin/pages/${page.contentId}/translations`;

    /**
     * Load the configured languages and this page's translations together,
     * so the list never shows one without the other.
     */
    const load = useCallback(async () => {
        try {
            const [languagesResponse, translationsResponse] = await Promise.all([
                fetch('/api/admin/system/localization/languages'),
                fetch(baseUrl)
            ]);
            if (!languagesResponse.ok) {
                throw new Error(await readError(languagesResponse, 'Failed to load languages'));
            }
            if (!translationsResponse.ok) {
                throw new Error(await readError(translationsResponse, 'Failed to load translations'));
            }
            const languagesData: { languages: ILanguage[] } = await languagesResponse.json();
            const translationsData: { translations: IPageTranslation[] } = await translationsResponse.json();
            setLanguages(languagesData.languages);
            setTranslations(translationsData.translations);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load translations');
        } finally {
            setLoading(false);
        }
    }, [baseUrl]);

    useEffect(
        /**
         * Load the list when the panel opens. The panel only appears after the
         * administrator clicks Translations, so this is a user-triggered load.
         */
        () => {
            void load();
        },
        [load]
    );

    useEffect(
        /**
         * Render a debounced preview of the translation being edited, through
         * the same endpoint the page editor uses so the two previews cannot
         * disagree.
         *
         * @returns Cleanup that cancels a preview still waiting to run.
         */
        () => {
            let cleanup: (() => void) | undefined;
            if (showPreview && draft) {
                /**
                 * Fetch the rendered HTML once typing has paused.
                 */
                const timeoutId = setTimeout(async () => {
                    try {
                        const response = await fetch('/api/admin/pages/preview', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content: draft.content })
                        });
                        if (!response.ok) {
                            throw new Error(await readError(response, 'Failed to generate preview'));
                        }
                        const data: { html: string } = await response.json();
                        setPreview(data.html);
                    } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to generate preview');
                    }
                }, 500);
                cleanup = () => clearTimeout(timeoutId);
            }

            return cleanup;
        },
        [showPreview, draft]
    );

    /**
     * Open the editor for a language, starting from the stored translation or
     * from the English text when there is none yet.
     *
     * @param language - The language to edit.
     * @param existing - The stored translation, or null to create one.
     */
    const openEditor = (language: ILanguage, existing: IPageTranslation | null) => {
        setDraft({ language, existing, content: existing?.content ?? buildTranslationTemplate(page) });
        setShowPreview(false);
        setPreview('');
        setError(null);
    };

    /**
     * Ask the AI model to translate the page into the draft's language and put
     * its markdown in the editor, then show what it said and what it cost.
     *
     * Nothing is saved: the administrator reviews the text and saves it as
     * usual. Text already typed in the editor would be lost, so the
     * administrator confirms before it is replaced. The toast stays open when
     * the model left notes, because those are meant to be read before saving;
     * a run with nothing to say closes on its own, as on the localization
     * Translations tab.
     */
    const suggestDraft = async () => {
        if (!draft) {
            return;
        }
        const startingContent = draft.existing?.content ?? buildTranslationTemplate(page);
        if (draft.content !== startingContent && !confirm('Replace the text in the editor with an AI suggestion?')) {
            return;
        }
        const requestLanguage = draft.language.code;
        setSuggesting(true);
        try {
            const response = await fetch(`${baseUrl}/${encodeURIComponent(requestLanguage)}/suggest`, { method: 'POST' });
            if (!response.ok) {
                throw new Error(await readError(response, 'Failed to suggest a translation'));
            }
            const result: IPageTranslationSuggestionResult = await response.json();
            if (draftLanguageRef.current === requestLanguage) {
                setDraft(current => (current ? { ...current, content: result.content } : current));
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
     * Save the draft: create the translation or replace its markdown. A
     * curator's save goes live at once; any other caller's is held in
     * System → Curation, which the list then shows.
     */
    const saveDraft = async () => {
        if (!draft || !draft.content.trim()) {
            setError('Content cannot be empty');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const response = draft.existing
                ? await fetch(`${baseUrl}/${encodeURIComponent(draft.language.code)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: draft.content })
                })
                : await fetch(baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ language: draft.language.code, content: draft.content })
                });
            if (!response.ok) {
                throw new Error(await readError(response, 'Failed to save translation'));
            }
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
        if (action === 'delete' && !confirm('Delete this translation? The page stops being served in this language. You can restore it later.')) {
            return;
        }
        try {
            const response = action === 'delete'
                ? await fetch(`${baseUrl}/${encodeURIComponent(language)}`, { method: 'DELETE' })
                : await fetch(`${baseUrl}/${encodeURIComponent(language)}/restore`, { method: 'POST' });
            if (!response.ok) {
                throw new Error(await readError(response, `Failed to ${action} translation`));
            }
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to ${action} translation`);
        }
    };

    const errorCard = error && (
        <Card tone="muted" padding="md">
            <p className={styles.error}>{error}</p>
        </Card>
    );

    if (draft) {
        return (
            <div className={styles.container}>
                <Card padding="md">
                    <div className={styles.header}>
                        <h2 className={styles.title}>
                            {draft.existing ? 'Edit' : 'Translate'}: {page.title} → {draft.language.name}
                        </h2>
                        <div className={styles.actions}>
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
                            <Button
                                variant="ghost"
                                size="md"
                                icon={<Eye size={18} />}
                                onClick={() => setShowPreview(!showPreview)}
                            >
                                {showPreview ? 'Show English' : 'Show Preview'}
                            </Button>
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
                </Card>

                {errorCard}

                {draft.existing?.stale && (
                    <Card tone="muted" padding="sm">
                        <p className={styles.notice}>
                            The English page has changed since this translation was saved. Saving records the
                            translation as matching the current English text.
                        </p>
                    </Card>
                )}

                <div className={styles.panes}>
                    <Card padding="md" className={styles.pane}>
                        <h3 className={styles.pane_title}>{showPreview ? 'Preview' : 'English (latest edit)'}</h3>
                        {showPreview ? (
                            <div className={styles.preview} dangerouslySetInnerHTML={{ __html: preview }} />
                        ) : (
                            <Textarea
                                className={styles.textarea}
                                value={page.content}
                                readOnly
                                aria-label="English page markdown"
                                spellCheck={false}
                            />
                        )}
                    </Card>
                    <Card padding="md" className={styles.pane}>
                        <h3 className={styles.pane_title}>{draft.language.name} ({draft.language.nativeName})</h3>
                        <Textarea
                            className={styles.textarea}
                            value={draft.content}
                            onChange={e => setDraft({ ...draft, content: e.target.value })}
                            aria-label={`${draft.language.name} translation markdown`}
                            spellCheck={false}
                        />
                    </Card>
                </div>

                <Card tone="muted" padding="sm">
                    <p className={styles.help}>
                        <strong>Frontmatter:</strong> <code>title</code> is required. <code>description</code>,
                        {' '}<code>keywords</code>, and <code>ogImage</code> are optional; without <code>ogImage</code>
                        {' '}the page&apos;s own image is used. Set <code>published: true</code> to serve the translation
                        at <code>{localizePath(page.slug, draft.language.code)}</code>. A <code>slug</code> here is
                        ignored, because a translation always uses its page&apos;s slug.
                    </p>
                </Card>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <Card padding="md">
                <div className={styles.header}>
                    <h2 className={styles.title}>Translations: {page.title}</h2>
                    <div className={styles.actions}>
                        <Button variant="secondary" size="md" icon={<ArrowLeft size={18} />} onClick={onClose}>
                            Back to pages
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
                        No languages are configured. Add one in System → Localization before translating pages.
                    </p>
                ) : (
                    <ul className={styles.list}>
                        {languages.map(language => {
                            const translation = translations.find(candidate => candidate.language === language.code) ?? null;
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
                                            {translation?.curation === 'pending' && (
                                                <Badge tone="warning"><Clock size={12} /> Awaiting review</Badge>
                                            )}
                                            {translation?.curation === 'rejected' && (
                                                <Badge tone="danger"><XCircle size={12} /> Edit rejected</Badge>
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
                                            {translation
                                                ? `Served at ${localizePath(page.slug, language.code)} while published${language.enabled ? '' : ' and the language is enabled'}.`
                                                : 'This page is not served in this language.'}
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
