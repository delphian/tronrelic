'use client';

/**
 * @fileoverview Routes tab of `/system/localization`.
 *
 * A route is the per-page switch that puts a language on the site. This tab
 * shows every route pattern as a row of a grid with one column per configured
 * language. Each cell holds the switch that publishes the route in that
 * language beside the number of keys rendered on the route that still lack a
 * translation in it, so the decision and the evidence for it sit together.
 * The count turns amber when the route is published and still has gaps,
 * because that is the case where visitors are reading English on a translated
 * page. "Show keys" opens the Translations tab filtered to that route, which
 * is the quickest way to fill the gaps.
 *
 * Fetches its own data on mount, as every `/system` manager does.
 *
 * @module modules/localization/components/admin/RoutesTab
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import type { ILanguageSummary, ILocalizedRouteSummary } from '@/types';
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
import { InlineAddForm } from './InlineAddForm';
import styles from './LocalizationAdmin.module.scss';

/** Element id of the add form, referenced by the header button's `aria-controls`. */
const ADD_FORM_ID = 'localization-add-route';

/** Props for {@link RoutesTab}. */
interface IRoutesTabProps {
    /** Open the Translations tab filtered to the keys rendered on a route. */
    onShowKeys: (pattern: string) => void;
}

/**
 * Pick the badge tone for one cell's missing count. A published route with
 * gaps is the only state where visitors see English on a translated page, so
 * it alone is a warning; gaps on an unpublished route are ordinary work in
 * progress.
 *
 * @param missing - Keys rendered on the route with no translation in the language.
 * @param published - Whether the route is published in the language.
 * @returns The tone the count badge takes.
 */
function missingTone(missing: number, published: boolean): 'success' | 'warning' | 'neutral' {
    let tone: 'success' | 'warning' | 'neutral' = 'success';
    if (missing > 0) {
        tone = published ? 'warning' : 'neutral';
    }
    return tone;
}

/**
 * Describe one cell's missing count in a sentence, for the badge's tooltip and
 * for screen readers, since the badge itself shows only the number.
 *
 * @param missing - Keys rendered on the route with no translation in the language.
 * @param published - Whether the route is published in the language.
 * @param languageName - The language's English name.
 * @returns The sentence.
 */
function describeMissing(missing: number, published: boolean, languageName: string): string {
    let text = `Every key on this route has a ${languageName} translation`;
    if (missing > 0) {
        text = published
            ? `${missing} keys have no ${languageName} translation, so visitors see English for them`
            : `${missing} keys still need a ${languageName} translation`;
    }
    return text;
}

/**
 * The Routes tab: the route-by-language grid and its add form.
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
    const [adding, setAdding] = useState(false);
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
     * Reload routes and languages together, since the grid needs both.
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
     * Submit the add-route form, then close it so the grid is back in view.
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
            setAdding(false);
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

    // With no routes the form is the only useful thing on the tab, so it stays
    // open and the header button that toggles it is not offered.
    const empty = !loading && routes.length === 0;
    const formOpen = adding || empty;

    return (
        <Panel
            title="Routes"
            meta="Counts are keys still untranslated on each route"
            actions={!empty && (
                <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={16} />}
                    aria-expanded={formOpen}
                    aria-controls={ADD_FORM_ID}
                    onClick={() => setAdding(current => !current)}
                >
                    Add route
                </Button>
            )}
        >
            {formOpen && (
                <InlineAddForm
                    id={ADD_FORM_ID}
                    label="Add a route"
                    submitLabel="Add route"
                    submitting={creating}
                    onSubmit={event => void handleCreate(event)}
                >
                    <Field label="Route pattern" className={styles.form_field}>
                        <Input
                            size="sm"
                            value={pattern}
                            placeholder="/about, /token/:id, /blog/*"
                            title=":name matches one path segment; a final * matches everything below"
                            onChange={event => setPattern(event.target.value)}
                            required
                        />
                    </Field>
                    <fieldset className={styles.form_toggles}>
                        <legend className={styles.form_toggles_label}>Publish in</legend>
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
                    </fieldset>
                </InlineAddForm>
            )}

            {loading ? (
                <div className={styles.placeholder}>Loading routes…</div>
            ) : empty ? (
                <div className={styles.placeholder}>No routes yet, so every page is English only.</div>
            ) : (
                <Table variant="compact" flush className={styles.stack_table}>
                    <Thead>
                        <Tr>
                            <Th>Route</Th>
                            {languages.map(language => (
                                <Th key={language.code} width="shrink">
                                    <span className={styles.language_head} title={language.name}>
                                        {language.code}
                                        {!language.enabled && <Badge size="xs" tone="neutral">off</Badge>}
                                    </span>
                                </Th>
                            ))}
                            <Th width="shrink"><span className={styles.visually_hidden}>Actions</span></Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {routes.map(route => (
                            <Tr key={route.id}>
                                <Td data-label="Route">
                                    <div className={styles.cell_inline}>
                                        <span className={`${styles.cell_primary} ${styles.mono}`}>{route.pattern}</span>
                                        <span className={styles.cell_meta}>{route.keyCount} keys</span>
                                    </div>
                                </Td>
                                {languages.map(language => {
                                    const published = route.languages.includes(language.code);
                                    const missing = route.missingByLanguage[language.code] ?? 0;
                                    const description = describeMissing(missing, published, language.name);
                                    return (
                                        <Td key={language.code} data-label={language.name}>
                                            <span className={styles.route_cell}>
                                                <Switch
                                                    size="sm"
                                                    on={published}
                                                    disabled={busyId === route.id}
                                                    onChange={next => void handleToggle(route, language.code, next)}
                                                    aria-label={`Publish ${route.pattern} in ${language.name}`}
                                                />
                                                <Badge size="xs" tone={missingTone(missing, published)} title={description}>
                                                    {missing}
                                                    <span className={styles.visually_hidden}>. {description}</span>
                                                </Badge>
                                            </span>
                                        </Td>
                                    );
                                })}
                                <Td data-label="Actions">
                                    <div className={styles.actions}>
                                        <IconButton
                                            size="sm"
                                            onClick={() => onShowKeys(route.pattern)}
                                            aria-label={`Show keys rendered on ${route.pattern}`}
                                            title="Show keys"
                                        >
                                            <ListChecks size={14} />
                                        </IconButton>
                                        <IconButton
                                            size="sm"
                                            variant="danger"
                                            onClick={() => handleDelete(route)}
                                            aria-label={`Remove ${route.pattern}`}
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
