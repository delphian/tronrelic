'use client';

/**
 * @fileoverview Languages tab of `/system/localization`.
 *
 * Lists the configured languages with how far each one's translation has got,
 * lets an administrator add one, switch it on or off for visitors, change its
 * script direction, edit the translation prompt the AI Suggest buttons send
 * for it, or remove it. Adding a language changes nothing a visitor
 * sees, and enabling one only allows routes to be published in it, so this tab
 * is safe to use before any translation work is done.
 *
 * The tab is one panel. The add form opens from the panel header and sits
 * above the table, and the consequences of switching a language on or off are
 * stated in the toast that confirms the switch, where the administrator reads
 * them at the moment they apply. Each count column shows three numbers in the
 * status colours, with the words written once in its header, so the table
 * fits a tablet and stacks only on a phone.
 *
 * Like the other `/system` managers it fetches its own data on mount: the
 * SSR + Live Updates rule covers public pages, and admin surfaces are exempt
 * by the `/system` convention.
 *
 * @module modules/localization/components/admin/LanguagesTab
 */

import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { MessageSquareText, Plus, Trash2 } from 'lucide-react';
import type { ILanguageSummary, ITranslationProgress, LanguageDirection } from '@/types';
import { Panel } from '../../../../components/ui/Panel';
import { Button } from '../../../../components/ui/Button';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import { Field } from '../../../../components/ui/Field';
import { Switch } from '../../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import { createLanguage, deleteLanguage, listLanguages, updateLanguage } from '../../api/client';
import { InlineAddForm } from './InlineAddForm';
import { LanguagePromptDialog } from './LanguagePromptDialog';
import styles from './LocalizationAdmin.module.scss';

/** Empty values for the add-language form. */
const EMPTY_FORM = { code: '', name: '', nativeName: '', direction: 'ltr' as LanguageDirection };

/** Element id of the add form, referenced by the header button's `aria-controls`. */
const ADD_FORM_ID = 'localization-add-language';

/** Thousands separators fixed to one locale, so every admin reads the same digits. */
const COUNT = new Intl.NumberFormat('en');

/**
 * The three counts in the order the legend names them, each with the class
 * that colours it. One list, so the legend and every cell cannot disagree
 * about which number is which.
 */
const PROGRESS_PARTS: ReadonlyArray<{ status: keyof ITranslationProgress; className: string }> = [
    { status: 'translated', className: styles.progress_translated },
    { status: 'stale', className: styles.progress_stale },
    { status: 'missing', className: styles.progress_missing }
];

/** What the On published routes counts cover, for that column's tooltip. */
const PUBLISHED_ROUTES_TITLE = 'Keys rendered on routes published in the language, the same keys the Routes tab counts';

/** What the All keys counts cover, for that column's tooltip. */
const ALL_KEYS_TITLE = 'Every key the site has reported, including text seen only on pages not yet published in the language';

/**
 * Name the three counts in their colours. The column headers carry it, and so
 * does a line above the table once the rows stack and the headers are hidden,
 * so the words appear once rather than in every cell.
 *
 * @returns The coloured "translated / stale / missing" key.
 */
function ProgressLegend() {
    return (
        <span className={styles.progress}>
            {PROGRESS_PARTS.map((part, index) => (
                <Fragment key={part.status}>
                    {index > 0 && <span className={styles.progress_separator} aria-hidden="true">/</span>}
                    <span className={part.className}>{part.status}</span>
                </Fragment>
            ))}
        </span>
    );
}

/**
 * Show one set of translation counts as three numbers in the status colours.
 * The table shows two sets per language, one for the routes published in it
 * and one for every key, so one component draws both to keep them alike. Each
 * number carries its word as visually hidden text, so a screen reader hears
 * "1,206 translated" rather than a bare figure.
 *
 * @param props.progress - The translated, stale, and missing counts to show.
 * @returns The counts; a zero is drawn quietly rather than left out, so each
 *          number stays in the place the legend gives it.
 */
function ProgressFigures({ progress }: { progress: ITranslationProgress }) {
    return (
        <span className={styles.progress}>
            {PROGRESS_PARTS.map((part, index) => {
                const value = progress[part.status];
                const text = `${COUNT.format(value)} ${part.status}`;
                return (
                    <Fragment key={part.status}>
                        {index > 0 && <span className={styles.progress_separator} aria-hidden="true">/</span>}
                        <span className={value === 0 ? styles.progress_zero : part.className} title={text}>
                            {COUNT.format(value)}
                            <span className={styles.visually_hidden}> {part.status}</span>
                        </span>
                    </Fragment>
                );
            })}
        </span>
    );
}

/**
 * Sum up the language list for the panel's meta line.
 *
 * @param languages - The configured languages.
 * @returns A short line such as "8 languages · 5 enabled".
 */
function describeLanguages(languages: ILanguageSummary[]): string {
    const enabled = languages.filter(language => language.enabled).length;
    return `${languages.length} ${languages.length === 1 ? 'language' : 'languages'} · ${enabled} enabled`;
}

/**
 * The Languages tab: the language table and its add form.
 *
 * @returns The tab content.
 */
export function LanguagesTab() {
    const [languages, setLanguages] = useState<ILanguageSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyCode, setBusyCode] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [adding, setAdding] = useState(false);
    const [creating, setCreating] = useState(false);
    const { push } = useToast();
    const { open, close } = useModal();

    /**
     * Show the outcome of an action, carrying the backend's message on failure
     * so the administrator learns why, for example, a language cannot be enabled.
     *
     * @param description - What the change means for visitors, on success.
     */
    const notify = useCallback((tone: 'success' | 'danger', title: string, error?: unknown, description?: string) => {
        const errorText = error ? (error instanceof Error ? error.message : String(error)) : undefined;
        push({ tone, title, description: errorText ?? description });
    }, [push]);

    /**
     * Reload the language table from the backend.
     */
    const load = useCallback(async () => {
        try {
            setLanguages(await listLanguages());
        } catch (error) {
            notify('danger', 'Could not load languages', error);
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Submit the add-language form, then close it so the table is back in view.
     *
     * @param event - The form submission.
     */
    const handleCreate = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        setCreating(true);
        try {
            await createLanguage(form);
            setForm(EMPTY_FORM);
            setAdding(false);
            notify('success', `Added ${form.name}`, undefined, 'It stays off until you enable it.');
            await load();
        } catch (error) {
            notify('danger', 'Could not add language', error);
        } finally {
            setCreating(false);
        }
    }, [form, load, notify]);

    /**
     * Switch a language on or off for visitors. The toast says what the switch
     * means, because that is the moment the administrator needs to know it.
     *
     * @param language - The row being toggled.
     * @param enabled - The new state.
     */
    const handleToggle = useCallback(async (language: ILanguageSummary, enabled: boolean) => {
        setBusyCode(language.code);
        try {
            await updateLanguage(language.code, { enabled });
            notify(
                'success',
                `${language.name} ${enabled ? 'enabled' : 'disabled'}`,
                undefined,
                enabled
                    ? `Pages answer at /${language.code}/ once their route is published in it.`
                    : `Its /${language.code}/ pages are offline. Translations are kept.`
            );
            await load();
        } catch (error) {
            notify('danger', `Could not ${enabled ? 'enable' : 'disable'} ${language.name}`, error);
        } finally {
            setBusyCode(null);
        }
    }, [load, notify]);

    /**
     * Change a language's script direction.
     *
     * @param language - The row being changed.
     * @param direction - The new direction.
     */
    const handleDirection = useCallback(async (language: ILanguageSummary, direction: LanguageDirection) => {
        setBusyCode(language.code);
        try {
            await updateLanguage(language.code, { direction });
            await load();
        } catch (error) {
            notify('danger', `Could not update ${language.name}`, error);
        } finally {
            setBusyCode(null);
        }
    }, [load, notify]);

    /**
     * Open the editor for a language's translation prompt. The dialog saves
     * on its own; this closes it, confirms the save, and reloads the table so
     * the row's prompt indicator updates.
     *
     * @param language - The row whose prompt to edit.
     */
    const handleEditPrompt = useCallback((language: ILanguageSummary) => {
        const modalId = open({
            title: `${language.name} translation prompt`,
            size: 'md',
            content: (
                <LanguagePromptDialog
                    language={language}
                    onCancel={() => close(modalId)}
                    onSaved={() => {
                        close(modalId);
                        notify('success', `Saved the ${language.name} translation prompt`, undefined, 'Suggest buttons use it from the next request.');
                        void load();
                    }}
                    onError={error => notify('danger', `Could not save the ${language.name} translation prompt`, error)}
                />
            )
        });
    }, [close, load, notify, open]);

    /**
     * Ask for confirmation, then remove a language with its translations.
     *
     * @param language - The row to remove.
     */
    const handleDelete = useCallback((language: ILanguageSummary) => {
        const modalId = open({
            title: 'Delete language',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={`Delete ${language.name}?`}
                    message={`This removes ${language.translated + language.stale} translations into ${language.name} and takes it off every route. Its /${language.code}/ pages stop working at once.`}
                    confirmLabel="Delete"
                    onCancel={() => close(modalId)}
                    onConfirm={async () => {
                        try {
                            await deleteLanguage(language.code);
                            notify('success', `Deleted ${language.name}`);
                            await load();
                        } catch (error) {
                            notify('danger', `Could not delete ${language.name}`, error);
                        } finally {
                            close(modalId);
                        }
                    }}
                />
            )
        });
    }, [close, load, notify, open]);

    // With no languages the form is the only useful thing on the tab, so it
    // stays open and the header button that toggles it is not offered.
    const empty = !loading && languages.length === 0;
    const formOpen = adding || empty;

    return (
        <Panel
            title="Languages"
            meta={!loading && !empty ? describeLanguages(languages) : undefined}
            actions={!empty && (
                <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={16} />}
                    aria-expanded={formOpen}
                    aria-controls={ADD_FORM_ID}
                    onClick={() => setAdding(current => !current)}
                >
                    Add language
                </Button>
            )}
        >
            {formOpen && (
                <InlineAddForm
                    id={ADD_FORM_ID}
                    label="Add a language"
                    submitLabel="Add language"
                    submitting={creating}
                    onSubmit={event => void handleCreate(event)}
                >
                    <Field label="Code" className={styles.form_field_narrow}>
                        <Input
                            size="sm"
                            value={form.code}
                            placeholder="zh, pt-BR"
                            onChange={event => setForm({ ...form, code: event.target.value })}
                            required
                        />
                    </Field>
                    <Field label="English name" className={styles.form_field}>
                        <Input
                            size="sm"
                            value={form.name}
                            placeholder="Chinese"
                            onChange={event => setForm({ ...form, name: event.target.value })}
                            required
                        />
                    </Field>
                    <Field label="Native name, shown in the switcher" className={styles.form_field}>
                        <Input
                            size="sm"
                            value={form.nativeName}
                            placeholder="中文"
                            onChange={event => setForm({ ...form, nativeName: event.target.value })}
                            required
                        />
                    </Field>
                    <Field label="Direction" className={styles.form_field_narrow}>
                        <Select
                            size="sm"
                            value={form.direction}
                            onChange={event => setForm({ ...form, direction: event.target.value as LanguageDirection })}
                        >
                            <option value="ltr">Left to right</option>
                            <option value="rtl">Right to left</option>
                        </Select>
                    </Field>
                </InlineAddForm>
            )}

            {loading ? (
                <div className={styles.placeholder}>Loading languages…</div>
            ) : empty ? (
                <div className={styles.placeholder}>No languages yet. Add the first one above.</div>
            ) : (
                <>
                    <p className={styles.progress_key}>Counts: <ProgressLegend /></p>
                    {/* The counts are numbers rather than worded badges, so
                        the six columns fit a tablet and the rows stack only on
                        a phone. The Enabled switch and the actions carry no
                        `label`, so once stacked the switch shares the name's
                        line and the buttons end the entry's last line. */}
                    <Table variant="compact" flush stackAt="mobile">
                        <Thead>
                            <Tr>
                                <Th>Language</Th>
                                <Th width="shrink">Enabled</Th>
                                <Th title={PUBLISHED_ROUTES_TITLE}>
                                    On published routes
                                    <span className={styles.th_legend}><ProgressLegend /></span>
                                </Th>
                                <Th title={ALL_KEYS_TITLE}>
                                    All keys
                                    <span className={styles.th_legend}><ProgressLegend /></span>
                                </Th>
                                <Th width="shrink">Direction</Th>
                                <Th width="shrink"><span className={styles.visually_hidden}>Actions</span></Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {languages.map(language => (
                                <Tr key={language.code}>
                                    <Td>
                                        <div className={styles.cell_inline}>
                                            <span className={styles.cell_primary} lang={language.code}>{language.nativeName}</span>
                                            <span className={styles.cell_meta}>{language.name}</span>
                                            <span className={`${styles.cell_meta} ${styles.mono}`}>{language.code}</span>
                                        </div>
                                    </Td>
                                    <Td>
                                        <Switch
                                            size="sm"
                                            on={language.enabled}
                                            disabled={busyCode === language.code}
                                            onChange={next => void handleToggle(language, next)}
                                            aria-label={`${language.enabled ? 'Disable' : 'Enable'} ${language.name}`}
                                            title={language.enabled ? 'Enabled for visitors' : 'Not enabled for visitors'}
                                        />
                                    </Td>
                                    <Td label="Published routes">
                                        <ProgressFigures progress={language.publishedRoutes} />
                                    </Td>
                                    <Td label="All keys">
                                        <ProgressFigures progress={language} />
                                    </Td>
                                    <Td label="Direction">
                                        <Select
                                            size="xs"
                                            value={language.direction}
                                            disabled={busyCode === language.code}
                                            onChange={event => void handleDirection(language, event.target.value as LanguageDirection)}
                                            aria-label={`Script direction for ${language.name}`}
                                        >
                                            <option value="ltr">Left to right</option>
                                            <option value="rtl">Right to left</option>
                                        </Select>
                                    </Td>
                                    <Td>
                                        <div className={styles.actions}>
                                            <IconButton
                                                size="sm"
                                                variant={language.translationPrompt === '' ? 'ghost' : 'primary'}
                                                onClick={() => handleEditPrompt(language)}
                                                aria-label={`${language.translationPrompt === '' ? 'Add' : 'Edit'} the translation prompt for ${language.name}`}
                                                title={language.translationPrompt === '' ? 'No translation prompt yet' : 'Has a translation prompt'}
                                            >
                                                <MessageSquareText size={14} />
                                            </IconButton>
                                            <IconButton
                                                size="sm"
                                                variant="danger"
                                                onClick={() => handleDelete(language)}
                                                aria-label={`Delete ${language.name}`}
                                            >
                                                <Trash2 size={14} />
                                            </IconButton>
                                        </div>
                                    </Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                </>
            )}
        </Panel>
    );
}
