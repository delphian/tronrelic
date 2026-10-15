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
 * Fetches its own data on mount and on every filter change, as every
 * `/system` manager does.
 *
 * @module modules/localization/components/admin/TranslationsTab
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, Save, Search, Trash2, X } from 'lucide-react';
import type { ILanguageSummary, ITranslationNamespaceSummary, ITranslationRow, TranslationStatus } from '@/types';
import { Stack } from '../../../../components/layout';
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
    listTranslations,
    saveTranslation
} from '../../api/client';
import styles from './LocalizationAdmin.module.scss';

/** Rows per page. */
const PAGE_SIZE = 50;

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
 * The Translations tab: filters, the paged key table with inline editing, and
 * the add-key form.
 *
 * @param props - An optional route filter to start from.
 * @returns The tab content.
 */
export function TranslationsTab({ initialRoute }: ITranslationsTabProps) {
    const [languages, setLanguages] = useState<ILanguageSummary[]>([]);
    const [namespaces, setNamespaces] = useState<ITranslationNamespaceSummary[]>([]);
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
    const [creating, setCreating] = useState(false);
    const { push } = useToast();
    const { open, close } = useModal();

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
     * Load the languages and namespaces the filters offer. Picks the first
     * language so the table has something to show.
     */
    const loadFilters = useCallback(async () => {
        try {
            const [nextLanguages, nextNamespaces] = await Promise.all([listLanguages(), listNamespaces()]);
            setLanguages(nextLanguages);
            setNamespaces(nextNamespaces);
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
     * Submit the add-key form.
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
            await Promise.all([loadRows(), loadFilters()]);
        } catch (error) {
            notify('danger', 'Could not add key', error);
        } finally {
            setCreating(false);
        }
    }, [loadFilters, loadRows, newKey, notify]);

    const currentLanguage = languages.find(entry => entry.code === language);

    return (
        <Stack gap="md">
            <Panel title="Translations" meta={`${total} keys match`}>
                <Stack gap="sm">
                    <p className={styles.intro}>
                        Keys appear here the first time the site renders them. Translations show to visitors only on routes
                        published in that language, so translate first and publish when the route&apos;s count reaches zero.
                    </p>
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
                                <Input
                                    size="sm"
                                    className={styles.filters_search}
                                    value={searchDraft}
                                    onChange={event => setSearchDraft(event.target.value)}
                                    placeholder="Search keys and English text"
                                    aria-label="Search keys and English text"
                                />
                                <Button type="submit" size="sm" variant="secondary" icon={<Search size={16} />}>Search</Button>
                            </form>
                            {route && (
                                <div className={styles.route_filter}>
                                    Showing keys rendered on <span className={styles.mono}>{route}</span>
                                    <IconButton size="sm" onClick={() => { setRoute(''); setPage(1); }} aria-label="Clear the route filter">
                                        <X size={14} />
                                    </IconButton>
                                </div>
                            )}
                            {loading ? (
                                <div className={styles.placeholder}>Loading translations…</div>
                            ) : rows.length === 0 ? (
                                <div className={styles.placeholder}>No keys match these filters.</div>
                            ) : (
                                <Table className={styles.stack_table}>
                                    <Thead>
                                        <Tr>
                                            <Th>Key</Th>
                                            <Th>English</Th>
                                            <Th width="expand">{currentLanguage?.name ?? language}</Th>
                                            <Th width="shrink">Status</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {rows.map(row => {
                                            const id = rowId(row);
                                            const draft = drafts[id] ?? row.translation?.text ?? '';
                                            const busy = busyId === id;
                                            return (
                                                <Tr key={id}>
                                                    <Td data-label="Key">
                                                        <div className={`${styles.cell_primary} ${styles.mono}`}>{row.key}</div>
                                                        <div className={styles.cell_meta}>
                                                            {row.namespace} · {row.origin === 'manual' ? 'added by hand' : `seen on ${row.routes.slice(0, 3).join(', ') || 'no page yet'}`}
                                                        </div>
                                                    </Td>
                                                    <Td data-label="English">{row.source}</Td>
                                                    <Td data-label={currentLanguage?.name ?? language}>
                                                        <div className={styles.editor}>
                                                            <Textarea
                                                                size="sm"
                                                                rows={2}
                                                                value={draft}
                                                                disabled={busy}
                                                                onChange={event => setDrafts(current => ({ ...current, [id]: event.target.value }))}
                                                                aria-label={`${currentLanguage?.name ?? language} text for ${row.key}`}
                                                            />
                                                            <div className={styles.editor_actions}>
                                                                <Button
                                                                    size="xs"
                                                                    variant="primary"
                                                                    loading={busy}
                                                                    disabled={draft.trim() === '' || draft === (row.translation?.text ?? '')}
                                                                    onClick={() => void handleSave(row)}
                                                                    icon={<Save size={14} />}
                                                                >
                                                                    Save
                                                                </Button>
                                                                {row.translation && (
                                                                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => void handleRemoveTranslation(row)}>
                                                                        Remove
                                                                    </Button>
                                                                )}
                                                                <IconButton
                                                                    size="sm"
                                                                    variant="danger"
                                                                    disabled={busy}
                                                                    onClick={() => handleDeleteKey(row)}
                                                                    aria-label={`Delete key ${row.key}`}
                                                                >
                                                                    <Trash2 size={14} />
                                                                </IconButton>
                                                            </div>
                                                        </div>
                                                    </Td>
                                                    <Td data-label="Status">
                                                        <Badge size="sm" tone={STATUS_TONE[row.status]}>{row.status}</Badge>
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
                </Stack>
            </Panel>

            <Panel title="Add a key by hand" meta="For text you want ready before any page renders it">
                <form className={styles.form_row} onSubmit={event => void handleCreateKey(event)}>
                    <Field label="Namespace" hint="core, or a plugin id" className={styles.form_field_narrow}>
                        <Input value={newKey.namespace} onChange={event => setNewKey({ ...newKey, namespace: event.target.value })} required />
                    </Field>
                    <Field label="Key" hint="As passed to t(), e.g. markets.title" className={styles.form_field}>
                        <Input value={newKey.key} onChange={event => setNewKey({ ...newKey, key: event.target.value })} required />
                    </Field>
                    <Field label="English text" className={styles.form_field}>
                        <Input value={newKey.source} onChange={event => setNewKey({ ...newKey, source: event.target.value })} required />
                    </Field>
                    <Button type="submit" variant="primary" loading={creating} icon={<Plus size={18} />}>
                        Add key
                    </Button>
                </form>
            </Panel>
        </Stack>
    );
}
