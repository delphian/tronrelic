'use client';

/**
 * @fileoverview Routes tab of `/system/localization`.
 *
 * A route is the per-page switch that puts a language on the site. This tab
 * lists every published route pattern with a toggle per configured language,
 * and shows how many of the keys rendered on that route still lack a
 * translation, so an administrator can see before switching a language on
 * whether the page would show English text. "Show keys" opens the
 * Translations tab filtered to that route, which is the quickest way to fill
 * the gaps.
 *
 * Fetches its own data on mount, as every `/system` manager does.
 *
 * @module modules/localization/components/admin/RoutesTab
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import type { ILanguageSummary, ILocalizedRouteSummary } from '@/types';
import { Stack } from '../../../../components/layout';
import { Panel } from '../../../../components/ui/Panel';
import { Button } from '../../../../components/ui/Button';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { Field } from '../../../../components/ui/Field';
import { Switch } from '../../../../components/ui/Switch';
import { Badge } from '../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import { createRoute, deleteRoute, listLanguages, listRoutes, updateRoute } from '../../api/client';
import styles from './LocalizationAdmin.module.scss';

/** Props for {@link RoutesTab}. */
interface IRoutesTabProps {
    /** Open the Translations tab filtered to the keys rendered on a route. */
    onShowKeys: (pattern: string) => void;
}

/**
 * The Routes tab: the published-route table and the add-route form.
 *
 * @param props - The callback that switches to the filtered Translations tab.
 * @returns The tab content.
 */
export function RoutesTab({ onShowKeys }: IRoutesTabProps) {
    const [routes, setRoutes] = useState<ILocalizedRouteSummary[]>([]);
    const [languages, setLanguages] = useState<ILanguageSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pattern, setPattern] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
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

    /**
     * Reload routes and languages together, since the table needs both.
     */
    const load = useCallback(async () => {
        try {
            const [nextRoutes, nextLanguages] = await Promise.all([listRoutes(), listLanguages()]);
            setRoutes(nextRoutes);
            setLanguages(nextLanguages);
        } catch (error) {
            notify('danger', 'Could not load routes', error);
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Submit the add-route form.
     *
     * @param event - The form submission.
     */
    const handleCreate = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        setCreating(true);
        try {
            await createRoute({ pattern, languages: selected });
            notify('success', `Added ${pattern}`);
            setPattern('');
            setSelected([]);
            await load();
        } catch (error) {
            notify('danger', 'Could not add route', error);
        } finally {
            setCreating(false);
        }
    }, [load, notify, pattern, selected]);

    /**
     * Publish or unpublish a route in one language.
     *
     * @param route - The route row.
     * @param code - The language being toggled.
     * @param on - Whether the route should be published in it.
     */
    const handleToggle = useCallback(async (route: ILocalizedRouteSummary, code: string, on: boolean) => {
        const languagesNext = on ? [...route.languages, code] : route.languages.filter(entry => entry !== code);
        setBusyId(route.id);
        try {
            await updateRoute(route.id, { languages: languagesNext });
            await load();
        } catch (error) {
            notify('danger', `Could not update ${route.pattern}`, error);
        } finally {
            setBusyId(null);
        }
    }, [load, notify]);

    /**
     * Ask for confirmation, then stop publishing a route.
     *
     * @param route - The route row to remove.
     */
    const handleDelete = useCallback((route: ILocalizedRouteSummary) => {
        const modalId = open({
            title: 'Remove route',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={`Remove ${route.pattern}?`}
                    message="Its translated addresses stop working at once. Translations are kept and come back if the route is published again."
                    confirmLabel="Remove"
                    onCancel={() => close(modalId)}
                    onConfirm={async () => {
                        try {
                            await deleteRoute(route.id);
                            notify('success', `Removed ${route.pattern}`);
                            await load();
                        } catch (error) {
                            notify('danger', `Could not remove ${route.pattern}`, error);
                        } finally {
                            close(modalId);
                        }
                    }}
                />
            )
        });
    }, [close, load, notify, open]);

    /**
     * Toggle a language in the add-route form.
     *
     * @param code - The language code.
     * @param on - Whether it is selected.
     */
    const toggleSelected = useCallback((code: string, on: boolean) => {
        setSelected(current => (on ? [...current, code] : current.filter(entry => entry !== code)));
    }, []);

    return (
        <Stack gap="md">
            <Panel title="Published routes" meta="A route answers in a language only while that language is also enabled">
                <Stack gap="sm">
                    <p className={styles.intro}>
                        Each pattern covers every address its template serves: /about is one page, :name matches one
                        segment, and a final * matches the rest, as in /blog/*. The missing counts cover the keys the site has
                        rendered on that route so far; publish only when they reach zero, or visitors see English text.
                    </p>
                    {loading ? (
                        <div className={styles.placeholder}>Loading routes…</div>
                    ) : routes.length === 0 ? (
                        <div className={styles.placeholder}>No routes are published. Every page is English only.</div>
                    ) : (
                        <Table className={styles.stack_table}>
                            <Thead>
                                <Tr>
                                    <Th>Route</Th>
                                    <Th>Languages</Th>
                                    <Th>Missing translations</Th>
                                    <Th width="shrink"><span className={styles.visually_hidden}>Actions</span></Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {routes.map(route => (
                                    <Tr key={route.id}>
                                        <Td data-label="Route">
                                            <div className={`${styles.cell_primary} ${styles.mono}`}>{route.pattern}</div>
                                            <div className={styles.cell_meta}>{route.keyCount} keys rendered</div>
                                        </Td>
                                        <Td data-label="Languages">
                                            <div className={styles.toggle_row}>
                                                {languages.map(language => (
                                                    <span key={language.code} className={styles.toggle}>
                                                        <Switch
                                                            size="sm"
                                                            on={route.languages.includes(language.code)}
                                                            disabled={busyId === route.id}
                                                            onChange={next => void handleToggle(route, language.code, next)}
                                                            aria-label={`Publish ${route.pattern} in ${language.name}`}
                                                        />
                                                        {language.code}
                                                        {!language.enabled && <Badge size="xs" tone="neutral">off</Badge>}
                                                    </span>
                                                ))}
                                            </div>
                                        </Td>
                                        <Td data-label="Missing translations">
                                            <div className={styles.badge_row}>
                                                {languages.map(language => {
                                                    const missing = route.missingByLanguage[language.code] ?? 0;
                                                    return (
                                                        <Badge key={language.code} size="sm" tone={missing > 0 ? 'warning' : 'success'}>
                                                            {language.code}: {missing}
                                                        </Badge>
                                                    );
                                                })}
                                            </div>
                                        </Td>
                                        <Td data-label="Actions">
                                            <div className={styles.actions}>
                                                <IconButton onClick={() => onShowKeys(route.pattern)} aria-label={`Show keys rendered on ${route.pattern}`}>
                                                    <ListChecks size={16} />
                                                </IconButton>
                                                <IconButton variant="danger" onClick={() => handleDelete(route)} aria-label={`Remove ${route.pattern}`}>
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

            <Panel title="Publish a route">
                <form onSubmit={event => void handleCreate(event)}>
                    <Stack gap="sm">
                        <div className={styles.form_row}>
                            <Field label="Route pattern" hint="For example /markets or /blog/*" className={styles.form_field}>
                                <Input value={pattern} onChange={event => setPattern(event.target.value)} required />
                            </Field>
                        </div>
                        {languages.length === 0 ? (
                            <p className={styles.intro}>Add a language on the Languages tab first.</p>
                        ) : (
                            <div className={styles.toggle_row}>
                                {languages.map(language => (
                                    <span key={language.code} className={styles.toggle}>
                                        <Switch
                                            size="sm"
                                            on={selected.includes(language.code)}
                                            onChange={next => toggleSelected(language.code, next)}
                                            aria-label={`Publish in ${language.name}`}
                                        />
                                        {language.name}
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className={styles.form_actions}>
                            <Button type="submit" variant="primary" loading={creating} icon={<Plus size={18} />}>
                                Publish route
                            </Button>
                        </div>
                    </Stack>
                </form>
            </Panel>
        </Stack>
    );
}
