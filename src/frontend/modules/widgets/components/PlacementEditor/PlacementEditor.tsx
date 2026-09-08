'use client';

/**
 * @fileoverview The form that adds or edits one placement.
 *
 * Rendered inside a slide-over so the board stays visible while an
 * operator edits: they can see the zone they are adding to and the rows
 * around it. The form is organised by the questions an operator asks in
 * order: which widget, where it shows, what heading it carries, and how it
 * is configured. Removal and restoring plugin defaults live in the footer
 * here rather than on the row, so a row stays scannable and a destructive
 * action always sits next to the thing it destroys.
 *
 * @module modules/widgets/components/PlacementEditor
 */

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, RefreshCw, Trash2, X } from 'lucide-react';
import type {
    IPlacementInput,
    IPlacementPatch,
    IWidgetPlacement,
    IWidgetTypeSnapshot,
    IZoneLayoutConfig,
    IZoneSnapshot,
    WidgetTitleSize
} from '@/types';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { Input } from '../../../../components/ui/Input';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { Select } from '../../../../components/ui/Select';
import { Switch } from '../../../../components/ui/Switch';
import { Textarea } from '../../../../components/ui/Textarea';
import {
    buildStructuredConfig,
    coerceInitialConfig,
    draftConfigJson,
    extractConfigFields,
    fieldSpansRow
} from '../../lib/configSchema';
import { toLayoutConfig } from '../../lib/layoutPresets';
import { LAYOUT_GROUP_TYPE_ID, findWidgetType, findZone, providerLabel } from '../../lib/placementLookup';
import { normaliseRouteInput } from '../../lib/routeMatcher';
import type { EditorTarget } from '../../types/IEditorTarget';
import { InstanceConfigField } from '../InstanceConfigField';
import { LayoutConfigControls } from '../LayoutConfigControls';
import styles from './PlacementEditor.module.scss';

/** Which pages a placement shows on. */
type RouteScope = 'all' | 'some';

/**
 * Props for the editor form.
 */
export interface IPlacementEditorProps {
    /** What is being edited. */
    target: EditorTarget;
    types: IWidgetTypeSnapshot | null;
    zones: IZoneSnapshot | null;
    /** Every placement, so the form can offer the zone's layout groups as containers. */
    placements: IWidgetPlacement[];
    /** The page the board is scoped to, offered as a one-click route. */
    selectedRoute: string | null;
    /** Create a row; throws on failure with a readable message. */
    onCreate: (input: IPlacementInput) => Promise<void>;
    /** Patch a row; throws on failure with a readable message. */
    onSave: (id: string, patch: IPlacementPatch) => Promise<void>;
    onCancel: () => void;
    /** Present in edit mode for operator rows. */
    onRemove?: (placement: IWidgetPlacement) => void;
    /** Present in edit mode for plugin rows. */
    onRestore?: (placement: IWidgetPlacement) => void;
}

/**
 * A titled group of related fields.
 *
 * @param props.title - Short group name.
 * @param props.action - Optional control at the right of the heading.
 * @param props.children - The group's fields.
 * @returns The section.
 */
function FormSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    const headingId = useId();
    return (
        <section className={styles.section} aria-labelledby={headingId}>
            <div className={styles.section_header}>
                <h3 id={headingId} className={styles.section_title}>{title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

/**
 * The add or edit form.
 *
 * @param props - See {@link IPlacementEditorProps}.
 * @returns The form.
 */
export function PlacementEditor({
    target,
    types,
    zones,
    placements,
    selectedRoute,
    onCreate,
    onSave,
    onCancel,
    onRemove,
    onRestore
}: IPlacementEditorProps) {
    const mode = target.mode;
    const initial = target.mode === 'edit' ? target.placement : undefined;
    const seedRoutes = target.mode === 'create' ? target.routes : [...(initial?.routes ?? [])];

    const [typeId, setTypeId] = useState<string>(initial?.typeId ?? (target.mode === 'create' ? target.typeId ?? '' : ''));
    const [zoneId, setZoneId] = useState<string>(initial?.zoneId ?? (target.mode === 'create' ? target.zoneId ?? '' : ''));
    const [parentId, setParentId] = useState<string>(initial?.parentId ?? (target.mode === 'create' ? target.parentId ?? '' : ''));
    const [routeScope, setRouteScope] = useState<RouteScope>(seedRoutes.length > 0 ? 'some' : 'all');
    const [routes, setRoutes] = useState<string[]>(seedRoutes);
    const [routeDraft, setRouteDraft] = useState('');
    const [routeError, setRouteError] = useState<string | null>(null);
    const [title, setTitle] = useState<string>(initial?.title ?? '');
    const [titleUrl, setTitleUrl] = useState<string>(initial?.titleUrl ?? '');
    const [titleSize, setTitleSize] = useState<WidgetTitleSize>(initial?.titleSize ?? 'heading-md');
    const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const formId = useId();
    const selectedType = useMemo(() => findWidgetType(types, typeId), [types, typeId]);
    const selectedSchema = selectedType?.configSchema;
    const configFields = useMemo(() => extractConfigFields(selectedSchema), [selectedSchema]);
    const hasSchemaFields = configFields.length > 0;
    const isLayoutGroup = typeId === LAYOUT_GROUP_TYPE_ID;

    // Containers the row may nest in: layout groups in the chosen zone,
    // excluding the row itself.
    const containers = useMemo(
        () => placements.filter(p => p.typeId === LAYOUT_GROUP_TYPE_ID && !p.parentId && p.id !== initial?.id && p.zoneId === zoneId),
        [placements, initial?.id, zoneId]
    );

    // Drop a stale container when the zone or type changes under it.
    useEffect(() => {
        if (parentId && !containers.some(c => c.id === parentId)) setParentId('');
    }, [containers, parentId]);

    const nested = !isLayoutGroup && parentId.length > 0;

    const [configValue, setConfigValue] = useState<Record<string, unknown>>(
        () => coerceInitialConfig(configFields, initial?.instanceConfig as Record<string, unknown> | undefined)
    );
    const [rawMode, setRawMode] = useState<boolean>(() => !hasSchemaFields);
    const [rawText, setRawText] = useState<string>(
        () => (initial?.instanceConfig ? JSON.stringify(initial.instanceConfig, null, 2) : '')
    );
    const [configError, setConfigError] = useState<string | null>(null);

    // Switching type in create mode swaps the schema: reset the settings
    // to the new schema's defaults.
    useEffect(() => {
        if (mode === 'create') {
            setConfigValue(coerceInitialConfig(configFields, undefined));
            setRawMode(configFields.length === 0);
            setRawText('');
            setConfigError(null);
        }
    }, [mode, configFields]);

    const layoutGroupConfig = useMemo(
        () => (isLayoutGroup ? toLayoutConfig(configValue) : null),
        [isLayoutGroup, configValue]
    );

    /**
     * Copy an edited layout back into the working config, key by key, so
     * the raw view and the save path see the object the schema validates.
     *
     * @param config - The layout the shared editor produced.
     */
    const applyLayoutGroupConfig = useCallback((config: IZoneLayoutConfig) => {
        const source = config as unknown as Record<string, unknown>;
        setConfigValue(prev => {
            const next = { ...prev };
            for (const field of configFields) {
                if (field.key in source) next[field.key] = source[field.key];
            }
            return next;
        });
    }, [configFields]);

    /** Switch to raw JSON, seeded from the current form values. */
    const enterRawMode = useCallback(() => {
        setRawText(draftConfigJson(configFields, configValue));
        setConfigError(null);
        setRawMode(true);
    }, [configFields, configValue]);

    /** Switch back to the form, parsing the JSON; stays in raw mode on a parse error. */
    const exitRawMode = useCallback(() => {
        const trimmed = rawText.trim();
        let parsed: Record<string, unknown> | undefined;
        let error: string | null = null;
        if (trimmed.length > 0) {
            try {
                const candidate: unknown = JSON.parse(trimmed);
                if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
                    error = 'Settings must be a JSON object.';
                } else {
                    parsed = candidate as Record<string, unknown>;
                }
            } catch (err) {
                error = err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON';
            }
        }
        if (error) {
            setConfigError(error);
        } else {
            setConfigValue(coerceInitialConfig(configFields, parsed));
            setConfigError(null);
            setRawMode(false);
        }
    }, [configFields, rawText]);

    /**
     * Add a route from the draft field after validating it.
     *
     * @param raw - The text to add.
     */
    const addRoute = useCallback((raw: string) => {
        const path = normaliseRouteInput(raw);
        if (!path) {
            setRouteError('Enter a path starting with /, with no spaces. Use * only at the end, as /* or /**.');
        } else if (routes.includes(path)) {
            setRouteError('That path is already listed.');
        } else {
            setRoutes(prev => [...prev, path]);
            setRouteDraft('');
            setRouteError(null);
        }
    }, [routes]);

    const handleRouteKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addRoute(routeDraft);
        }
    }, [addRoute, routeDraft]);

    /**
     * Resolve the settings object from whichever editor is active. An
     * empty result means "no overrides" on create and "clear overrides" on
     * edit, because omitting the field on a patch would keep the old value.
     *
     * @returns The settings, or an error to show.
     */
    const resolveConfig = (): { value?: Record<string, unknown>; error?: string } => {
        let result: { value?: Record<string, unknown>; error?: string };
        if (rawMode) {
            const trimmed = rawText.trim();
            if (trimmed.length === 0) {
                result = { value: mode === 'edit' ? {} : undefined };
            } else {
                try {
                    const candidate: unknown = JSON.parse(trimmed);
                    result = !candidate || typeof candidate !== 'object' || Array.isArray(candidate)
                        ? { error: 'Settings must be a JSON object.' }
                        : { value: candidate as Record<string, unknown> };
                } catch (err) {
                    result = { error: err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON' };
                }
            }
        } else {
            const built = buildStructuredConfig(configFields, configValue);
            if (built.error) {
                result = { error: built.error };
            } else {
                const obj = built.value ?? {};
                result = { value: Object.keys(obj).length === 0 ? (mode === 'edit' ? {} : undefined) : obj };
            }
        }
        return result;
    };

    /**
     * Validate the settings, build the create input or the three-state
     * patch, and hand it to the workbench. Errors from the server are shown
     * in the footer so the operator can correct and retry without losing
     * the form.
     *
     * @param e - The form submit event.
     */
    const handleSubmit = async (e: FormEvent): Promise<void> => {
        e.preventDefault();
        const config = resolveConfig();
        if (config.error) {
            setConfigError(config.error);
            return;
        }
        setConfigError(null);
        // An empty list under "Only some pages" would be sent as `routes: []`,
        // which the resolver reads as "every page" — the opposite of what this
        // form promises. Make the operator name a page or switch scope first.
        if (!nested && routeScope === 'some' && routes.length === 0) {
            setRouteError('Add at least one page, or choose Every page.');
            return;
        }
        setSaveError(null);
        setSaving(true);

        const effectiveRoutes = nested || routeScope === 'all' ? [] : routes;
        const trimmedTitle = title.trim();
        const trimmedTitleUrl = titleUrl.trim();

        try {
            if (mode === 'create') {
                await onCreate({
                    typeId,
                    zoneId,
                    parentId: !isLayoutGroup && parentId.length > 0 ? parentId : undefined,
                    routes: effectiveRoutes,
                    title: trimmedTitle.length > 0 ? trimmedTitle : undefined,
                    titleUrl: trimmedTitleUrl.length > 0 ? trimmedTitleUrl : undefined,
                    titleSize: titleSize !== 'heading-md' ? titleSize : undefined,
                    instanceConfig: config.value,
                    enabled
                });
            } else if (initial) {
                // Three-state fields: set when non-empty, null to clear a
                // value the row had, omitted when nothing changed.
                const hadTitle = typeof initial.title === 'string' && initial.title.length > 0;
                const hadTitleUrl = typeof initial.titleUrl === 'string' && initial.titleUrl.length > 0;
                const hadParent = typeof initial.parentId === 'string';
                const initialTitleSize: WidgetTitleSize = initial.titleSize ?? 'heading-md';
                await onSave(initial.id, {
                    zoneId,
                    parentId: isLayoutGroup ? undefined : parentId.length > 0 ? parentId : hadParent ? null : undefined,
                    routes: effectiveRoutes,
                    title: trimmedTitle.length > 0 ? trimmedTitle : hadTitle ? null : undefined,
                    titleUrl: trimmedTitleUrl.length > 0 ? trimmedTitleUrl : hadTitleUrl ? null : undefined,
                    titleSize: titleSize === initialTitleSize ? undefined : titleSize === 'heading-md' ? null : titleSize,
                    instanceConfig: config.value,
                    enabled
                });
            }
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const canSubmit = typeId.length > 0 && zoneId.length > 0 && !saving;
    const zone = findZone(zones, zoneId);
    const routesId = `${formId}-routes`;

    /**
     * The settings body for the current type and mode.
     *
     * @returns The settings controls.
     */
    const renderSettings = (): ReactNode => {
        let body: ReactNode;
        if (typeId.length === 0) {
            body = <p className={styles.placeholder}>Choose a widget to see its settings.</p>;
        } else if (rawMode) {
            body = (
                <Field
                    hint={hasSchemaFields
                        ? 'Checked against the widget’s settings schema when saved.'
                        : 'This widget declares no settings. JSON entered here is passed to it as overrides.'}
                    error={configError ?? undefined}
                >
                    <Textarea
                        id={`${formId}-config-json`}
                        size="sm"
                        className={styles.json}
                        rows={8}
                        value={rawText}
                        onChange={(e) => { setRawText(e.target.value); setConfigError(null); }}
                        placeholder="{}"
                        disabled={saving}
                        spellCheck={false}
                        invalid={configError !== null}
                        aria-label="Settings as JSON"
                    />
                </Field>
            );
        } else if (layoutGroupConfig) {
            body = (
                <LayoutConfigControls
                    idPrefix={`${formId}-layout`}
                    layout={layoutGroupConfig}
                    disabled={saving}
                    onChange={applyLayoutGroupConfig}
                />
            );
        } else {
            body = (
                <div className={styles.grid}>
                    {configFields.map(field => (
                        <InstanceConfigField
                            key={field.key}
                            field={field}
                            value={configValue[field.key]}
                            idPrefix={`${formId}-config`}
                            disabled={saving}
                            className={fieldSpansRow(field) ? styles.span : undefined}
                            onChange={(next) => setConfigValue(prev => ({ ...prev, [field.key]: next }))}
                        />
                    ))}
                </div>
            );
        }
        return body;
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <FormSection title="Widget">
                {mode === 'create' ? (
                    <Field label="Widget" required hint={selectedType?.description}>
                        <Select
                            id={`${formId}-type`}
                            size="sm"
                            value={typeId}
                            onChange={(e) => setTypeId(e.target.value)}
                            disabled={saving}
                            required
                        >
                            <option value="">Choose a widget</option>
                            {types?.groups.map(group => (
                                <optgroup key={group.pluginId} label={providerLabel(group.pluginId)}>
                                    {group.types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </optgroup>
                            ))}
                        </Select>
                    </Field>
                ) : (
                    <div className={styles.static}>
                        <span className={styles.static_value}>
                            <span>{selectedType?.label ?? typeId}</span>
                            <code className={styles.static_code}>{typeId}</code>
                            {selectedType && <span className={styles.static_meta}>from {providerLabel(selectedType.pluginId)}</span>}
                        </span>
                        {selectedType?.description && <span className={styles.hint}>{selectedType.description}</span>}
                        {!selectedType && (
                            <span className={styles.hint}>
                                This widget type is not registered right now, usually because its plugin is disabled. The row keeps its settings and renders again when the plugin returns.
                            </span>
                        )}
                        {initial?.source === 'plugin' && (
                            <span className={styles.hint}>
                                Placed by its plugin. Your changes survive the plugin being turned off and on; use Restore defaults to undo them.
                            </span>
                        )}
                    </div>
                )}
            </FormSection>

            <FormSection title="Where it shows">
                <div className={styles.grid}>
                    <Field label="Zone" required hint={zone?.description}>
                        <Select
                            id={`${formId}-zone`}
                            size="sm"
                            value={zoneId}
                            onChange={(e) => setZoneId(e.target.value)}
                            disabled={saving}
                            required
                        >
                            <option value="">Choose a zone</option>
                            {zones?.tracks.map(track => (
                                <optgroup key={track.id} label={track.label}>
                                    {track.zones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
                                </optgroup>
                            ))}
                        </Select>
                    </Field>

                    {!isLayoutGroup && containers.length > 0 && (
                        <Field
                            label="Inside a layout group"
                            hint={nested ? 'A grouped widget follows the group’s pages and arrangement.' : undefined}
                        >
                            <Select
                                id={`${formId}-parent`}
                                size="sm"
                                value={parentId}
                                onChange={(e) => setParentId(e.target.value)}
                                disabled={saving}
                            >
                                <option value="">No, directly in the zone</option>
                                {containers.map(c => (
                                    <option key={c.id} value={c.id}>{c.title ?? 'Layout group'} (…{c.id.slice(-6)})</option>
                                ))}
                            </Select>
                        </Field>
                    )}
                </div>

                {!nested && (
                    <div className={styles.field_group}>
                        <span className={styles.label}>Pages</span>
                        <SegmentedControl<RouteScope>
                            label="Which pages"
                            value={routeScope}
                            disabled={saving}
                            onChange={(scope) => {
                                setRouteScope(scope);
                                if (scope === 'some' && routes.length === 0 && selectedRoute) setRoutes([selectedRoute]);
                            }}
                            options={[
                                { id: 'all', label: 'Every page' },
                                { id: 'some', label: 'Only some pages' }
                            ]}
                        />
                        {routeScope === 'some' && (
                            <Field
                                htmlFor={routesId}
                                error={routeError ?? undefined}
                                hint={(
                                    <>
                                        Exact paths, <code>/tools/*</code> for one level below, or <code>/system/**</code> for any depth. Press Enter to add.
                                    </>
                                )}
                            >
                                <div className={styles.routes}>
                                    {routes.length > 0 && (
                                        <div className={styles.chips}>
                                            {routes.map(entry => (
                                                <span key={entry} className={styles.chip}>
                                                    <code>{entry}</code>
                                                    <button
                                                        type="button"
                                                        aria-label={`Remove ${entry}`}
                                                        onClick={() => setRoutes(prev => prev.filter(r => r !== entry))}
                                                        disabled={saving}
                                                        className={styles.chip_remove}
                                                    >
                                                        <X size={12} aria-hidden />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <div className={styles.routes_input}>
                                        <Input
                                            id={routesId}
                                            size="sm"
                                            value={routeDraft}
                                            onChange={(e) => { setRouteDraft(e.target.value); setRouteError(null); }}
                                            onKeyDown={handleRouteKey}
                                            placeholder="/about"
                                            disabled={saving}
                                            invalid={routeError !== null}
                                            aria-describedby={routeError ? `${routesId}-error` : `${routesId}-hint`}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => addRoute(routeDraft)}
                                            disabled={saving || routeDraft.trim().length === 0}
                                        >
                                            Add
                                        </Button>
                                        {selectedRoute && !routes.includes(selectedRoute) && (
                                            <Button type="button" variant="ghost" size="sm" onClick={() => addRoute(selectedRoute)} disabled={saving}>
                                                Add {selectedRoute}
                                            </Button>
                                        )}
                                    </div>
                                    {routes.length === 0 && (
                                        <span className={styles.hint}>No pages yet. Until you add one this widget shows nowhere.</span>
                                    )}
                                </div>
                            </Field>
                        )}
                    </div>
                )}
            </FormSection>

            <FormSection title="Heading">
                <div className={styles.grid}>
                    <Field label="Heading text" hint="Shown above the widget. Leave empty for none.">
                        <Input
                            id={`${formId}-title`}
                            size="sm"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="None"
                            maxLength={80}
                            disabled={saving}
                        />
                    </Field>
                    <Field label="Heading size">
                        <Select
                            id={`${formId}-title-size`}
                            size="sm"
                            value={titleSize}
                            onChange={(e) => setTitleSize(e.target.value as WidgetTitleSize)}
                            disabled={saving || title.trim().length === 0}
                        >
                            <option value="heading-xs">Extra small</option>
                            <option value="heading-sm">Small</option>
                            <option value="heading-md">Medium</option>
                            <option value="heading-lg">Large</option>
                            <option value="heading-xl">Extra large</option>
                        </Select>
                    </Field>
                    <Field
                        label="Heading links to"
                        hint="A path on this site, starting with /. Only used when there is heading text."
                        className={styles.span}
                    >
                        <Input
                            id={`${formId}-title-url`}
                            size="sm"
                            value={titleUrl}
                            onChange={(e) => setTitleUrl(e.target.value)}
                            placeholder="/markets"
                            maxLength={512}
                            disabled={saving || title.trim().length === 0}
                        />
                    </Field>
                </div>
            </FormSection>

            <FormSection
                title="Settings"
                action={hasSchemaFields ? (
                    <Button type="button" variant="ghost" size="xs" onClick={rawMode ? exitRawMode : enterRawMode} disabled={saving}>
                        {rawMode ? 'Use the form' : 'Edit as JSON'}
                    </Button>
                ) : undefined}
            >
                {renderSettings()}
            </FormSection>

            <div className={styles.footer}>
                <div className={styles.footer_left}>
                    <label className={styles.enabled}>
                        <Switch
                            size="sm"
                            on={enabled}
                            onChange={setEnabled}
                            disabled={saving}
                            aria-label="Shown on the site"
                        />
                        <span>{enabled ? 'Shown' : 'Hidden'}</span>
                    </label>
                    {mode === 'edit' && initial && onRemove && initial.source === 'operator' && (
                        <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => onRemove(initial)} disabled={saving}>
                            Remove
                        </Button>
                    )}
                    {mode === 'edit' && initial && onRestore && initial.source === 'plugin' && (
                        <Button type="button" variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => onRestore(initial)} disabled={saving}>
                            Restore defaults
                        </Button>
                    )}
                </div>
                {(saveError || (configError && !rawMode)) && (
                    <span className={styles.footer_error} role="alert">
                        <AlertCircle size={14} aria-hidden />
                        {saveError ?? configError}
                    </span>
                )}
                <div className={styles.footer_right}>
                    <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
                    <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>
                        {mode === 'create' ? 'Add widget' : 'Save changes'}
                    </Button>
                </div>
            </div>
        </form>
    );
}
