'use client';

/**
 * @fileoverview Languages tab of `/system/localization`.
 *
 * Lists the configured languages with how far each one's translation has got,
 * lets an administrator add one, switch it on or off for visitors, change its
 * script direction, or remove it. Adding a language changes nothing a visitor
 * sees, and enabling one only allows routes to be published in it, so this tab
 * is safe to use before any translation work is done.
 *
 * The tab is one panel. The add form opens from the panel header and sits
 * above the table, and the consequences of switching a language on or off are
 * stated in the toast that confirms the switch, where the administrator reads
 * them at the moment they apply.
 *
 * Like the other `/system` managers it fetches its own data on mount: the
 * SSR + Live Updates rule covers public pages, and admin surfaces are exempt
 * by the `/system` convention.
 *
 * @module modules/localization/components/admin/LanguagesTab
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ILanguageSummary, ITranslationProgress, LanguageDirection } from '@/types';
import { Panel } from '../../../../components/ui/Panel';
import { Button } from '../../../../components/ui/Button';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import { Field } from '../../../../components/ui/Field';
import { Switch } from '../../../../components/ui/Switch';
import { Badge } from '../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import { createLanguage, deleteLanguage, listLanguages, updateLanguage } from '../../api/client';
import { InlineAddForm } from './InlineAddForm';
import styles from './LocalizationAdmin.module.scss';

/** Empty values for the add-language form. */
const EMPTY_FORM = { code: '', name: '', nativeName: '', direction: 'ltr' as LanguageDirection };

/** Element id of the add form, referenced by the header button's `aria-controls`. */
const ADD_FORM_ID = 'localization-add-language';

/**
 * Show one set of translation counts as badges. The table shows two sets per
 * language, one for the routes published in it and one for every key, so the
 * badges are drawn by one component to keep the two columns alike.
 *
 * @param props.progress - The translated, stale, and missing counts to show.
 * @returns The badge row; stale and missing are left out when zero.
 */
function ProgressBadges({ progress }: { progress: ITranslationProgress }) {
    return (
        <div className={styles.badge_row}>
            <Badge size="xs" tone="success">{progress.translated} translated</Badge>
            {progress.stale > 0 && <Badge size="xs" tone="warning">{progress.stale} stale</Badge>}
            {progress.missing > 0 && <Badge size="xs" tone="neutral">{progress.missing} missing</Badge>}
        </div>
    );
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
     * @param tone - Success or failure.
     * @param title - What happened.
     * @param error - The thrown error, on failure.
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
            meta="English is always on and needs no setup. All keys includes text seen only on pages not yet published in the language"
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
                <Table variant="compact" flush className={styles.stack_table}>
                    <Thead>
                        <Tr>
                            <Th>Language</Th>
                            <Th>On published routes</Th>
                            <Th>All keys</Th>
                            <Th width="shrink">Direction</Th>
                            <Th width="shrink">Enabled</Th>
                            <Th width="shrink"><span className={styles.visually_hidden}>Actions</span></Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {languages.map(language => (
                            <Tr key={language.code}>
                                <Td data-label="Language">
                                    <div className={styles.cell_inline}>
                                        <span className={styles.cell_primary} lang={language.code}>{language.nativeName}</span>
                                        <span className={styles.cell_meta}>{language.name}</span>
                                        <span className={`${styles.cell_meta} ${styles.mono}`}>{language.code}</span>
                                    </div>
                                </Td>
                                <Td data-label="On published routes">
                                    <ProgressBadges progress={language.publishedRoutes} />
                                </Td>
                                <Td data-label="All keys">
                                    <ProgressBadges progress={language} />
                                </Td>
                                <Td data-label="Direction">
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
                                <Td data-label="Enabled">
                                    <Switch
                                        size="sm"
                                        on={language.enabled}
                                        disabled={busyCode === language.code}
                                        onChange={next => void handleToggle(language, next)}
                                        aria-label={`${language.enabled ? 'Disable' : 'Enable'} ${language.name}`}
                                    />
                                </Td>
                                <Td data-label="Actions">
                                    <div className={styles.actions}>
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
            )}
        </Panel>
    );
}
