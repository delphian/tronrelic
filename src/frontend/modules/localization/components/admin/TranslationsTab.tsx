'use client';

/**
 * @fileoverview Translations tab of `/system/localization`.
 *
 * The working surface for translators. Every key the site renders appears here
 * with its English source, reported automatically the first time the frontend
 * server renders it. The administrator picks a language, narrows the list by
 * namespace, status, text, or route, and types translations in place. A key
 * whose English source changed after its translation was saved is marked
 * stale, because the translation may no longer say the same thing.
 *
 * Saving a translation affects visitors only on routes published in that
 * language, so translating ahead of publishing is the intended workflow.
 *
 * Each row is laid out to be about as tall as its English text: the status
 * sits under the key, the editor grows with the text it holds, and the row's
 * buttons sit in their own column instead of a bar under every editor.
 * Ctrl+Enter (Cmd+Enter on a Mac) saves the row being edited, so a translator
 * can work down the page from the keyboard.
 *
 * The Suggest buttons ask the AI model chosen on the Settings tab for a
 * translation and place it in the editor, one row at a time or every missing
 * and stale row on the page at once. They never save: the administrator reads
 * the text and the model's notes, then saves the rows they accept.
 *
 * Fetches its own data on mount and on every filter change, as every
 * `/system` manager does.
 *
 * @module modules/localization/components/admin/TranslationsTab
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Eraser, Plus, Save, Search, Sparkles, Trash2 } from 'lucide-react';
import type {
    ILanguageSummary,
    ILocalizedRouteSummary,
    ITranslationNamespaceSummary,
    ITranslationRow,
    TranslationStatus
} from '@/types';
import { MAX_TRANSLATION_SUGGESTION_KEYS } from '@/types';
import { Panel } from '../../../../components/ui/Panel';
import { Button } from '../../../../components/ui/Button';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import { Textarea } from '../../../../components/ui/Textarea';
import { Field } from '../../../../components/ui/Field';
import { Badge } from '../../../../components/ui/Badge';
import { Pagination } from '../../../../components/ui/Pagination';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import {
    createKey,
    deleteKey,
    deleteTranslation,
    listLanguages,
    listNamespaces,
    listRoutes,
    listTranslations,
    saveTranslation,
    suggestTranslations
} from '../../api/client';
import { InlineAddForm } from './InlineAddForm';
import { SuggestionSummary } from './SuggestionSummary';
import styles from './LocalizationAdmin.module.scss';

/** Rows per page. */
const PAGE_SIZE = 50;

/** Element id of the add-key form, referenced by the header button's `aria-controls`. */
const ADD_FORM_ID = 'localization-add-key';

/**
 * Characters an editor line holds at the translation column's usual width.
 * Only an estimate for sizing the editor; the text still wraps on its own.
 */
const EDITOR_CHARS_PER_LINE = 60;

/** Tallest an editor starts out; longer text scrolls inside it. */
const EDITOR_MAX_ROWS = 4;

/** Badge tone for each status, so stale reads as a warning and done as success. */
const STATUS_TONE: Record<TranslationStatus, 'neutral' | 'warning' | 'success'> = {
    missing: 'neutral',
    stale: 'warning',
    translated: 'success'
};

/** Props for {@link TranslationsTab}. */
interface ITranslationsTabProps {
    /** Route pattern to filter by when the tab opens from the Routes tab. */
    initialRoute?: string;
}

/**
 * Identify a row for draft and busy state.
 *
 * @param row - A listing row.
 * @returns A key unique to the namespace and key.
 */
function rowId(row: { namespace: string; key: string }): string {
    return `${row.namespace}\u0000${row.key}`;
}

/**
 * Decide whether the whole-page Suggest button should fill a row. Rows already
 * translated are left alone, and so is any row holding text the administrator
 * typed but has not saved, so the button never overwrites their work.
 *
 * @param row - A listing row.
 * @param draft - The row's unsaved editor text, if any.
 * @returns True when the row needs a suggestion.
 */
function needsSuggestion(row: ITranslationRow, draft: string | undefined): boolean {
    const hasUnsavedText = draft !== undefined && draft !== (row.translation?.text ?? '');
    return row.status !== 'translated' && !hasUnsavedText;
}

/**
 * Size an editor to the text it is likely to hold. A fixed two-line editor
 * doubled the height of every row of short labels and still cut off long
 * descriptions, so the editor takes as many lines as the longer of the English
 * source and the current text need, within a small cap.
 *
 * @param source - The English text the translation is written from.
 * @param draft - The text currently in the editor.
 * @returns The number of rows the editor starts with.
 */
function editorRows(source: string, draft: string): number {
    const length = Math.max(source.length, draft.length);
    return Math.min(EDITOR_MAX_ROWS, Math.max(1, Math.ceil(length / EDITOR_CHARS_PER_LINE)));
}

/**
 * The Translations tab: filters, the paged key table with inline editing, and
 * the add-key form.
 *
 * @param props - An optional route filter to start from.
 * @returns The tab content.
 */
export function TranslationsTab({ initialRoute }: ITranslationsTabProps) {
    const [languages, setLanguages] = useState<ILanguageSummary[]>([]);
    const [namespaces, setNamespaces] = useState<ITranslationNamespaceSummary[]>([]);
    const [routes, setRoutes] = useState<ILocalizedRouteSummary[]>([]);
    const [language, setLanguage] = useState('');
    const [namespace, setNamespace] = useState('');
    const [status, setStatus] = useState<TranslationStatus | ''>('');
    const [route, setRoute] = useState(initialRoute ?? '');
    const [searchDraft, setSearchDraft] = useState('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [rows, setRows] = useState<ITranslationRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [busyId, setBusyId] = useState<string | null>(null);
    const [newKey, setNewKey] = useState({ namespace: 'core', key: '', source: '' });
    const [adding, setAdding] = useState(false);
    const [creating, setCreating] = useState(false);
    // Which suggestion request is running: a row id, 'page', or none. One at a
    // time, so two requests cannot race to fill the same editors.
    const [suggesting, setSuggesting] = useState<string | null>(null);
    // The language shown now, read when a suggestion returns. A request takes
    // seconds, and text written for one language must not land in another's
    // editors if the administrator switched language meanwhile.
    const languageRef = useRef(language);
    const { push } = useToast();
    const { open, close } = useModal();

    // Keep the ref on the language shown now, for suggestions that return late.
    useEffect(() => {
        languageRef.current = language;
    }, [language]);

    /**
     * Show the outcome of an action with the backend's message on failure.
     *
     * @param tone - Success or failure.
     * @param title - What happened.
     * @param error - The thrown error, on failure.
     */
    const notify = useCallback((tone: 'success' | 'danger', title: string, error?: unknown) => {
        push({ tone, title, description: error ? (error instanceof Error ? error.message : String(error)) : undefined });
    }, [push]);

    // A route chosen on the Routes tab replaces the current route filter.
    useEffect(() => {
        setRoute(initialRoute ?? '');
        setPage(1);
    }, [initialRoute]);

    /**
     * Load the languages, namespaces, and published routes the filters offer.
     * Picks the first language so the table has something to show.
     */
    const loadFilters = useCallback(async () => {
        try {
            const [nextLanguages, nextNamespaces, nextRoutes] = await Promise.all([
                listLanguages(),
                listNamespaces(),
                listRoutes()
            ]);
            setLanguages(nextLanguages);
            setNamespaces(nextNamespaces);
            setRoutes(nextRoutes);
            setLanguage(current => current || nextLanguages[0]?.code || '');
        } catch (error) {
            notify('danger', 'Could not load filters', error);
        }
    }, [notify]);

    useEffect(() => {
        void loadFilters();
    }, [loadFilters]);

    /**
     * Load the current page for the current filters.
     */
    const loadRows = useCallback(async () => {
        if (language) {
            setLoading(true);
            try {
                const result = await listTranslations({
                    language,
                    namespace: namespace || undefined,
                    status: status || undefined,
                    search: search || undefined,
                    route: route || undefined,
                    limit: PAGE_SIZE,
                    offset: (page - 1) * PAGE_SIZE
                });
                setRows(result.rows);
                setTotal(result.total);
                setDrafts({});
            } catch (error) {
                notify('danger', 'Could not load translations', error);
            } finally {
                setLoading(false);
            }
        } else {
            // No language configured yet, so there is nothing to list.
            setRows([]);
            setTotal(0);
            setLoading(false);
        }
    }, [language, namespace, notify, page, route, search, status]);

    useEffect(() => {
        void loadRows();
    }, [loadRows]);

    /**
     * Apply the typed search text.
     *
     * @param event - The search form submission.
     */
    const handleSearch = useCallback((event: FormEvent) => {
        event.preventDefault();
        setSearch(searchDraft.trim());
        setPage(1);
    }, [searchDraft]);

    /**
     * Save the draft translation for one row.
     *
     * @param row - The row being saved.
     */
    const handleSave = useCallback(async (row: ITranslationRow) => {
        const id = rowId(row);
        const text = drafts[id] ?? row.translation?.text ?? '';
        setBusyId(id);
        try {
            await saveTranslation({ namespace: row.namespace, key: row.key, language, text });
            notify('success', `Saved ${row.key}`);
            await loadRows();
        } catch (error) {
            notify('danger', `Could not save ${row.key}`, error);
        } finally {
            setBusyId(null);
        }
    }, [drafts, language, loadRows, notify]);

    /**
     * Save the row from the keyboard. Ctrl+Enter, or Cmd+Enter on a Mac, saves
     * the row whose editor has focus when it holds a change worth saving; a
     * plain Enter still adds a line break, since translations may need one.
     *
     * @param event - The key press inside a row's editor.
     * @param row - The row the editor belongs to.
     * @param canSave - Whether the editor holds unsaved, non-empty text and
     *        the row is not already saving, the same test the Save button uses.
     */
    const handleEditorKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>, row: ITranslationRow, canSave: boolean) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSave) {
            event.preventDefault();
            void handleSave(row);
        }
    }, [handleSave]);

    /**
     * Ask the AI model to translate some rows and place its text in their
     * editors, then show what it said and what it cost.
     *
     * The toast stays open when the model left notes, because those are meant
     * to be read before saving; a run with nothing to say closes on its own.
     *
     * @param target - What the request is for: a row id, or 'page'.
     * @param targetRows - The rows to translate.
     */
    const runSuggestion = useCallback(async (target: string, targetRows: ITranslationRow[]) => {
        const requestLanguage = language;
        setSuggesting(target);
        try {
            const result = await suggestTranslations({
                language: requestLanguage,
                keys: targetRows.map(row => ({ namespace: row.namespace, key: row.key }))
            });
            if (languageRef.current === requestLanguage) {
                setDrafts(current => {
                    const next = { ...current };
                    for (const suggestion of result.suggestions) {
                        next[rowId(suggestion)] = suggestion.text;
                    }
                    return next;
                });
                const hasNotes = result.notes !== null || result.unanswered.length > 0
                    || result.suggestions.some(suggestion => suggestion.note !== null);
                push({
                    tone: result.suggestions.length > 0 ? 'success' : 'warning',
                    title: `Suggested ${result.suggestions.length} of ${targetRows.length} — review, then save`,
                    description: <SuggestionSummary result={result} />,
                    duration: hasNotes ? 0 : undefined
                });
            } else {
                push({ tone: 'warning', title: 'Suggestions discarded', description: 'The language changed while the request was running.' });
            }
        } catch (error) {
            notify('danger', 'Could not suggest translations', error);
        } finally {
            setSuggesting(null);
        }
    }, [language, notify, push]);

    /**
     * Remove one row's translation so visitors see the English text again.
     *
     * @param row - The row whose translation to remove.
     */
    const handleRemoveTranslation = useCallback(async (row: ITranslationRow) => {
        const id = rowId(row);
        setBusyId(id);
        try {
            await deleteTranslation(row.namespace, row.key, language);
            notify('success', `Removed the ${language} text for ${row.key}`);
            await loadRows();
        } catch (error) {
            notify('danger', `Could not remove ${row.key}`, error);
        } finally {
            setBusyId(null);
        }
    }, [language, loadRows, notify]);

    /**
     * Ask for confirmation, then delete a key and every translation of it.
     *
     * @param row - The row whose key to delete.
     */
    const handleDeleteKey = useCallback((row: ITranslationRow) => {
        const modalId = open({
            title: 'Delete key',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={`Delete ${row.namespace}:${row.key}?`}
                    message="Its translations in every language are deleted too. If the code still renders it, the key reappears with its English text the next time the page is rendered."
                    confirmLabel="Delete"
                    onCancel={() => close(modalId)}
                    onConfirm={async () => {
                        try {
                            await deleteKey(row.namespace, row.key);
                            notify('success', `Deleted ${row.key}`);
                            await Promise.all([loadRows(), loadFilters()]);
                        } catch (error) {
                            notify('danger', `Could not delete ${row.key}`, error);
                        } finally {
                            close(modalId);
                        }
                    }}
                />
            )
        });
    }, [close, loadFilters, loadRows, notify, open]);

    /**
     * Submit the add-key form, then close it so the table is back in view.
     *
     * @param event - The form submission.
     */
    const handleCreateKey = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        setCreating(true);
        try {
            await createKey(newKey);
            notify('success', `Added ${newKey.namespace}:${newKey.key}`);
            setNewKey({ ...newKey, key: '', source: '' });
            setAdding(false);
            await Promise.all([loadRows(), loadFilters()]);
        } catch (error) {
            notify('danger', 'Could not add key', error);
        } finally {
            setCreating(false);
        }
    }, [loadFilters, loadRows, newKey, notify]);

    const currentLanguage = languages.find(entry => entry.code === language);
    const languageName = currentLanguage?.name ?? language;
    // A route filter set from the Routes tab can name a route deleted since the
    // list loaded. It still gets an option, so the dropdown never shows a
    // different value from the filter actually applied.
    const routeIsListed = !route || routes.some(entry => entry.pattern === route);
    const pageSuggestionRows = rows
        .filter(row => needsSuggestion(row, drafts[rowId(row)]))
        .slice(0, MAX_TRANSLATION_SUGGESTION_KEYS);
    // The pager renders nothing for a single page. Only then is the table the
    // last thing in the panel and free to run to its edges.
    const paged = total > PAGE_SIZE;

    return (
        <Panel
            title="Translations"
            meta={languages.length > 0 ? `${total} keys match. Ctrl+Enter saves a row.` : undefined}
            actions={(
                <>
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<Plus size={16} />}
                        aria-expanded={adding}
                        aria-controls={ADD_FORM_ID}
                        onClick={() => setAdding(current => !current)}
                        title="Add text you want ready before any page renders it"
                    >
                        Add key
                    </Button>
                    {languages.length > 0 && (
                        <Button
                            size="sm"
                            variant="secondary"
                            loading={suggesting === 'page'}
                            disabled={suggesting !== null || loading || pageSuggestionRows.length === 0}
                            onClick={() => void runSuggestion('page', pageSuggestionRows)}
                            icon={<Sparkles size={16} />}
                            title="Fill every missing and stale row on this page that has no unsaved text"
                        >
                            Suggest page ({pageSuggestionRows.length})
                        </Button>
                    )}
                </>
            )}
        >
            {adding && (
                <InlineAddForm
                    id={ADD_FORM_ID}
                    label="Add a key by hand"
                    submitLabel="Add key"
                    submitting={creating}
                    onSubmit={event => void handleCreateKey(event)}
                >
                    <Field label="Namespace" className={styles.form_field_narrow}>
                        <Input
                            size="sm"
                            value={newKey.namespace}
                            placeholder="core or a plugin id"
                            onChange={event => setNewKey({ ...newKey, namespace: event.target.value })}
                            required
                        />
                    </Field>
                    <Field label="Key, as passed to t()" className={styles.form_field}>
                        <Input
                            size="sm"
                            value={newKey.key}
                            placeholder="markets.title"
                            onChange={event => setNewKey({ ...newKey, key: event.target.value })}
                            required
                        />
                    </Field>
                    <Field label="English text" className={styles.form_field}>
                        <Input
                            size="sm"
                            value={newKey.source}
                            placeholder="Energy Markets"
                            onChange={event => setNewKey({ ...newKey, source: event.target.value })}
                            required
                        />
                    </Field>
                </InlineAddForm>
            )}

            {languages.length === 0 ? (
                <div className={styles.placeholder}>Add a language on the Languages tab to start translating.</div>
            ) : (
                <>
                    <form className={styles.filters} onSubmit={handleSearch}>
                        <Select
                            size="sm"
                            value={language}
                            onChange={event => { setLanguage(event.target.value); setPage(1); }}
                            aria-label="Language"
                        >
                            {languages.map(entry => (
                                <option key={entry.code} value={entry.code}>{entry.name} ({entry.code})</option>
                            ))}
                        </Select>
                        <Select
                            size="sm"
                            value={namespace}
                            onChange={event => { setNamespace(event.target.value); setPage(1); }}
                            aria-label="Namespace"
                        >
                            <option value="">All namespaces</option>
                            {namespaces.map(entry => (
                                <option key={entry.namespace} value={entry.namespace}>{entry.namespace} ({entry.keys})</option>
                            ))}
                        </Select>
                        <Select
                            size="sm"
                            value={status}
                            onChange={event => { setStatus(event.target.value as TranslationStatus | ''); setPage(1); }}
                            aria-label="Status"
                        >
                            <option value="">Any status</option>
                            <option value="missing">Missing</option>
                            <option value="stale">Stale</option>
                            <option value="translated">Translated</option>
                        </Select>
                        <Select
                            size="sm"
                            value={route}
                            onChange={event => { setRoute(event.target.value); setPage(1); }}
                            aria-label="Route"
                        >
                            <option value="">All routes</option>
                            {!routeIsListed && <option value={route}>{route}</option>}
                            {routes.map(entry => (
                                <option key={entry.id} value={entry.pattern}>{entry.pattern} ({entry.keyCount})</option>
                            ))}
                        </Select>
                        <div className={styles.filters_search}>
                            <Input
                                size="sm"
                                className={styles.filters_search_input}
                                value={searchDraft}
                                onChange={event => setSearchDraft(event.target.value)}
                                placeholder="Search keys and English text"
                                aria-label="Search keys and English text"
                            />
                            <IconButton type="submit" size="sm" aria-label="Search">
                                <Search size={16} />
                            </IconButton>
                        </div>
                    </form>

                    {loading ? (
                        <div className={styles.placeholder}>Loading translations…</div>
                    ) : rows.length === 0 ? (
                        <div className={styles.placeholder}>
                            No keys match. Keys appear here the first time the site renders them.
                        </div>
                    ) : (
                        <Table variant="compact" flush={!paged} className={`${styles.stack_table} ${styles.translation_table}`}>
                            <Thead>
                                <Tr>
                                    <Th className={styles.col_key}>Key</Th>
                                    <Th className={styles.col_source}>English</Th>
                                    <Th className={styles.col_translation}>{languageName}</Th>
                                    <Th width="shrink"><span className={styles.visually_hidden}>Actions</span></Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {rows.map(row => {
                                    const id = rowId(row);
                                    const saved = row.translation?.text ?? '';
                                    const draft = drafts[id] ?? saved;
                                    const busy = busyId === id;
                                    const canSave = !busy && draft.trim() !== '' && draft !== saved;
                                    return (
                                        <Tr key={id}>
                                            <Td data-label="Key">
                                                <div className={`${styles.cell_primary} ${styles.mono}`}>{row.key}</div>
                                                <div className={styles.cell_inline}>
                                                    <Badge size="xs" tone={STATUS_TONE[row.status]}>{row.status}</Badge>
                                                    <span className={styles.cell_meta}>{row.namespace}</span>
                                                    <span className={styles.cell_meta}>
                                                        {row.origin === 'manual'
                                                            ? 'added by hand'
                                                            : `seen on ${row.routes.slice(0, 3).join(', ') || 'no page yet'}`}
                                                    </span>
                                                </div>
                                            </Td>
                                            <Td data-label="English">
                                                <div className={styles.source_text}>{row.source}</div>
                                            </Td>
                                            <Td data-label={languageName}>
                                                <Textarea
                                                    size="sm"
                                                    rows={editorRows(row.source, draft)}
                                                    value={draft}
                                                    disabled={busy}
                                                    lang={language}
                                                    dir={currentLanguage?.direction}
                                                    onChange={event => setDrafts(current => ({ ...current, [id]: event.target.value }))}
                                                    onKeyDown={event => handleEditorKeyDown(event, row, canSave)}
                                                    aria-label={`${languageName} text for ${row.key}`}
                                                />
                                            </Td>
                                            <Td data-label="Actions">
                                                <div className={styles.actions}>
                                                    <Button
                                                        size="xs"
                                                        variant="primary"
                                                        loading={busy}
                                                        disabled={!canSave}
                                                        onClick={() => void handleSave(row)}
                                                        icon={<Save size={14} />}
                                                    >
                                                        Save
                                                    </Button>
                                                    <IconButton
                                                        size="sm"
                                                        variant="primary"
                                                        disabled={busy || suggesting !== null}
                                                        onClick={() => void runSuggestion(id, [row])}
                                                        aria-label={`Suggest a ${languageName} translation for ${row.key}`}
                                                        title="Suggest a translation"
                                                    >
                                                        <Sparkles size={14} />
                                                    </IconButton>
                                                    {row.translation && (
                                                        <IconButton
                                                            size="sm"
                                                            disabled={busy}
                                                            onClick={() => void handleRemoveTranslation(row)}
                                                            aria-label={`Remove the ${languageName} text for ${row.key}`}
                                                            title="Remove this translation, so visitors see English"
                                                        >
                                                            <Eraser size={14} />
                                                        </IconButton>
                                                    )}
                                                    <IconButton
                                                        size="sm"
                                                        variant="danger"
                                                        disabled={busy}
                                                        onClick={() => handleDeleteKey(row)}
                                                        aria-label={`Delete key ${row.key}`}
                                                        title="Delete this key in every language"
                                                    >
                                                        <Trash2 size={14} />
                                                    </IconButton>
                                                </div>
                                            </Td>
                                        </Tr>
                                    );
                                })}
                            </Tbody>
                        </Table>
                    )}
                    <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} onPageChange={setPage} />
                </>
            )}
        </Panel>
    );
}
