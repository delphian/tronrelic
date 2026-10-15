'use client';

/**
 * @fileoverview Languages tab of `/system/localization`.
 *
 * Lists the configured languages with how far each one's translation has got,
 * lets an administrator add one, switch it on or off for visitors, rename it,
 * or remove it. Adding a language changes nothing a visitor sees, and enabling
 * one only allows routes to be published in it, so this tab is safe to use
 * before any translation work is done.
 *
 * Like the other `/system` managers it fetches its own data on mount: the
 * SSR + Live Updates rule covers public pages, and admin surfaces are exempt
 * by the `/system` convention.
 *
 * @module modules/localization/components/admin/LanguagesTab
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ILanguageSummary, LanguageDirection } from '@/types';
import { Stack } from '../../../../components/layout';
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
import styles from './LocalizationAdmin.module.scss';

/** Empty values for the add-language form. */
const EMPTY_FORM = { code: '', name: '', nativeName: '', direction: 'ltr' as LanguageDirection };

/**
 * The Languages tab: the language table and the add-language form.
 *
 * @returns The tab content.
 */
export function LanguagesTab() {
    const [languages, setLanguages] = useState<ILanguageSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyCode, setBusyCode] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
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
     */
    const notify = useCallback((tone: 'success' | 'danger', title: string, error?: unknown) => {
        push({ tone, title, description: error ? (error instanceof Error ? error.message : String(error)) : undefined });
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
     * Submit the add-language form.
     *
     * @param event - The form submission.
     */
    const handleCreate = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        setCreating(true);
        try {
            await createLanguage(form);
            setForm(EMPTY_FORM);
            notify('success', `Added ${form.name}`);
            await load();
        } catch (error) {
            notify('danger', 'Could not add language', error);
        } finally {
            setCreating(false);
        }
    }, [form, load, notify]);

    /**
     * Switch a language on or off for visitors.
     *
     * @param language - The row being toggled.
     * @param enabled - The new state.
     */
    const handleToggle = useCallback(async (language: ILanguageSummary, enabled: boolean) => {
        setBusyCode(language.code);
        try {
            await updateLanguage(language.code, { enabled });
            notify('success', `${language.name} ${enabled ? 'enabled' : 'disabled'}`);
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

    return (
        <Stack gap="md">
            <Panel title="Languages" meta="English is the default and is always available">
                <Stack gap="sm">
                    <p className={styles.intro}>
                        Adding a language changes nothing visitors see. Enabling it lets routes be published in it on the
                        Routes tab; a page answers at its /code/ address only once its route lists the language. Disabling a
                        language takes all of its pages offline without deleting any translation.
                    </p>
                    {loading ? (
                        <div className={styles.placeholder}>Loading languages…</div>
                    ) : languages.length === 0 ? (
                        <div className={styles.placeholder}>No languages yet. Add one below.</div>
                    ) : (
                        <Table className={styles.stack_table}>
                            <Thead>
                                <Tr>
                                    <Th>Language</Th>
                                    <Th>Direction</Th>
                                    <Th>Progress</Th>
                                    <Th width="shrink">Visible</Th>
                                    <Th width="shrink"><span className={styles.visually_hidden}>Actions</span></Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {languages.map(language => (
                                    <Tr key={language.code}>
                                        <Td data-label="Language">
                                            <div className={styles.cell_primary} lang={language.code}>{language.nativeName}</div>
                                            <div className={styles.cell_meta}>{language.name} · <span className={styles.mono}>{language.code}</span></div>
                                        </Td>
                                        <Td data-label="Direction">
                                            <Select
                                                size="sm"
                                                value={language.direction}
                                                disabled={busyCode === language.code}
                                                onChange={event => void handleDirection(language, event.target.value as LanguageDirection)}
                                                aria-label={`Script direction for ${language.name}`}
                                            >
                                                <option value="ltr">Left to right</option>
                                                <option value="rtl">Right to left</option>
                                            </Select>
                                        </Td>
                                        <Td data-label="Progress">
                                            <div className={styles.badge_row}>
                                                <Badge size="sm" tone="success">{language.translated} translated</Badge>
                                                {language.stale > 0 && <Badge size="sm" tone="warning">{language.stale} stale</Badge>}
                                                <Badge size="sm" tone={language.missing > 0 ? 'neutral' : 'success'}>{language.missing} missing</Badge>
                                            </div>
                                        </Td>
                                        <Td data-label="Visible">
                                            <Switch
                                                on={language.enabled}
                                                disabled={busyCode === language.code}
                                                onChange={next => void handleToggle(language, next)}
                                                aria-label={`${language.enabled ? 'Disable' : 'Enable'} ${language.name}`}
                                            />
                                        </Td>
                                        <Td data-label="Actions">
                                            <div className={styles.actions}>
                                                <IconButton
                                                    variant="danger"
                                                    onClick={() => handleDelete(language)}
                                                    aria-label={`Delete ${language.name}`}
                                                >
                                                    <Trash2 size={16} />
                                                </IconButton>
                                            </div>
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    )}
                </Stack>
            </Panel>

            <Panel title="Add a language">
                <form onSubmit={event => void handleCreate(event)}>
                    <Stack gap="sm">
                        <div className={styles.form_row}>
                            <Field label="Code" hint="BCP 47, e.g. zh or pt-BR" className={styles.form_field_narrow}>
                                <Input value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} required />
                            </Field>
                            <Field label="English name" className={styles.form_field}>
                                <Input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required />
                            </Field>
                            <Field label="Native name" hint="Shown to visitors in the switcher" className={styles.form_field}>
                                <Input value={form.nativeName} onChange={event => setForm({ ...form, nativeName: event.target.value })} required />
                            </Field>
                            <Field label="Direction" className={styles.form_field_narrow}>
                                <Select value={form.direction} onChange={event => setForm({ ...form, direction: event.target.value as LanguageDirection })}>
                                    <option value="ltr">Left to right</option>
                                    <option value="rtl">Right to left</option>
                                </Select>
                            </Field>
                        </div>
                        <div className={styles.form_actions}>
                            <Button type="submit" variant="primary" loading={creating} icon={<Plus size={18} />}>
                                Add language
                            </Button>
                        </div>
                    </Stack>
                </form>
            </Panel>
        </Stack>
    );
}
