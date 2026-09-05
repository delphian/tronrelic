'use client';

/**
 * @fileoverview Operator UI for widget placements.
 *
 * Renders a per-zone view of every placement that resolves to that
 * zone, grouped by zone host (site / core / plugin / admin). Each row
 * surfaces source (plugin vs operator), route filter, render order,
 * and an enabled switch, plus inline edit / delete / restore-defaults
 * actions. Create-placement opens a modal with a type picker, a zone
 * picker, and a route chip input that accepts exact paths or globs
 * (`/tools/*`, `/system/**`).
 *
 * Lives behind the System container, which is admin-gated. Like
 * `/system/menu` and `/system/hooks` this is a client component
 * because the page needs hooks (`useModal`, `useToast`, WebSocket
 * subscription, redux). Admin auth runs on the cookie path —
 * same-origin fetches carry the Better Auth session cookie, which
 * `requireAdmin` consults. WebSocket subscription
 * to `widgets:placements-update` triggers a list refetch so admin
 * changes propagate live to every open admin tab.
 *
 * @module app/(core)/system/widgets/page
 */

import {
    Fragment,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useState,
    type FormEvent,
    type KeyboardEvent,
    type ReactNode
} from 'react';
import { AlertCircle, ArrowDown, ArrowUp, ChevronDown, ChevronUp, GripVertical, Pencil, Plus, RefreshCw, SlidersHorizontal, Trash2, Ungroup, X } from 'lucide-react';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCorners,
    pointerWithin,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type {
    IZoneSnapshot,
    IWidgetTypeSnapshot,
    IZoneLayoutConfig,
    ZoneLayoutPreset,
    WidgetTitleSize
} from '@/types';
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';

import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { Textarea } from '../../../../components/ui/Textarea';
import { Switch } from '../../../../components/ui/Switch';
import { Select } from '../../../../components/ui/Select';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useToast } from '../../../../components/ui/ToastProvider';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { cn } from '../../../../lib/cn';
import { getSocket } from '../../../../lib/socketClient';

import styles from './page.module.scss';

/**
 * Public-facing placement record returned by the admin list endpoint.
 * Mirrors `IWidgetPlacement` from the backend types package but
 * declared inline here so the frontend module is self-contained.
 */
interface IPlacement {
    id: string;
    typeId: string;
    zoneId: string;
    /**
     * Parent container placement id when this row is nested inside a
     * `core:layout-group`. Absent for directly-zoned placements.
     */
    parentId?: string;
    routes: string[];
    order: number;
    /**
     * Relative row width as a flex weight when the container lays out in a
     * row. Absent means auto (content) width. Edited via the per-row width
     * control on a layout group's children (and top-level zone rows).
     */
    layoutWeight?: number;
    title?: string;
    titleUrl?: string;
    titleSize?: WidgetTitleSize;
    instanceConfig?: Record<string, unknown>;
    enabled: boolean;
    source: 'plugin' | 'operator';
    pluginId?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Patch shape sent to PATCH /placements/:id. `title: null` is the
 * explicit unset signal honored server-side as `$unset: { title }`;
 * `titleUrl: null` clears the heading link the same way.
 */
interface IPlacementPatch {
    zoneId?: string;
    /**
     * Reparent the placement: a container id nests it, `null` detaches it
     * back to the zone, omission leaves it unchanged.
     */
    parentId?: string | null | undefined;
    routes?: string[];
    order?: number;
    /**
     * Set the relative row width, or clear it back to auto with `null`.
     * Omission leaves it unchanged — the same three-state convention as
     * `title`.
     */
    layoutWeight?: number | null | undefined;
    title?: string | null | undefined;
    titleUrl?: string | null | undefined;
    /**
     * Set the chrome title's heading size, clear it back to the default
     * (`heading-md`) with `null`, or omit to leave it unchanged.
     */
    titleSize?: WidgetTitleSize | null | undefined;
    instanceConfig?: Record<string, unknown>;
    enabled?: boolean;
}

/**
 * Create-placement input. Matches the backend controller's
 * normalised body.
 */
interface IPlacementCreate {
    typeId: string;
    zoneId: string;
    /** Optional container placement id to nest the new widget inside. */
    parentId?: string;
    routes: string[];
    order?: number;
    title?: string;
    titleUrl?: string;
    titleSize?: WidgetTitleSize;
    instanceConfig?: Record<string, unknown>;
    enabled?: boolean;
}

/**
 * Widget-type id of the structural layout-group container. Placements of
 * this type hold other widgets (via their `parentId`) and are edited with
 * the same flexbox config the per-zone layout control produces. Mirrors
 * the backend `LAYOUT_GROUP_TYPE_ID`.
 */
const LAYOUT_GROUP_TYPE_ID = 'core:layout-group';

/**
 * Translate a placement source into a Badge tone.
 */
function sourceTone(source: IPlacement['source']): 'info' | 'success' {
    return source === 'plugin' ? 'info' : 'success';
}

/**
 * Flatten the structured 400 body the placement API returns into a
 * single human-readable message for the toast. Server-side schema
 * validation surfaces a top-level `error` plus an `errors: [{path,
 * message}]` array; we render `path: message` lines beneath the
 * summary so an operator typing JSON sees which field failed without
 * having to inspect the network tab.
 */
function formatApiError(
    body: { error?: string; errors?: ReadonlyArray<{ path?: string; message?: string }> },
    status: number,
    verb: string
): string {
    const summary = body.error || `${verb} failed (${status})`;
    if (!Array.isArray(body.errors) || body.errors.length === 0) return summary;
    const fields = body.errors
        .map(e => `${e.path?.length ? e.path : '/'}: ${e.message ?? 'invalid'}`)
        .join('; ');
    return `${summary} — ${fields}`;
}

/**
 * Type-snapshot lookup utility — returns the type's label and
 * declaring plugin id for rendering inside the table.
 */
function lookupType(snapshot: IWidgetTypeSnapshot | null, typeId: string): { label: string; pluginId: string } | null {
    if (!snapshot) return null;
    for (const group of snapshot.groups) {
        for (const type of group.types) {
            if (type.id === typeId) return { label: type.label, pluginId: group.pluginId };
        }
    }
    return null;
}

/**
 * Zone-snapshot lookup — returns the zone label so the table can
 * render human-readable zone names without dropping back to id.
 */
function lookupZone(snapshot: IZoneSnapshot | null, zoneId: string): { label: string; host: string } | null {
    if (!snapshot) return null;
    for (const track of snapshot.tracks) {
        for (const zone of track.zones) {
            if (zone.id === zoneId) return { label: zone.label, host: zone.host };
        }
    }
    return null;
}

/**
 * Mirror of the backend `routeMatches` grammar
 * (`backend/modules/widgets/placements/route-matcher.ts`) so the editor
 * can filter placements to a chosen URL exactly the way SSR resolution
 * does. Kept in lockstep with the server: empty `routes` matches every
 * path; otherwise an entry matches as an exact path, a single-segment
 * glob (`/tools/*`), or a deep glob (`/system/**`).
 *
 * @param routes - Placement's route filter.
 * @param route - Selected URL path to test against.
 * @returns True when the placement should appear on the selected URL.
 */
function placementMatchesRoute(routes: ReadonlyArray<string>, route: string): boolean {
    if (routes.length === 0) return true;
    for (const pattern of routes) {
        if (pattern === route) return true;
        if (pattern.endsWith('/**')) {
            const prefix = pattern.slice(0, -3);
            if (prefix.length === 0 ? route.startsWith('/') : route.startsWith(`${prefix}/`)) return true;
        } else if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2);
            if (route.startsWith(`${prefix}/`)) {
                const remainder = route.slice(prefix.length + 1);
                if (remainder.length > 0 && remainder.indexOf('/') === -1) return true;
            }
        }
    }
    return false;
}

/**
 * Light client-side validation for the new-URL input, mirroring the
 * server's `normaliseRoutePattern` rules the admin API enforces: must be
 * a non-empty, whitespace-free path starting with `/`. Returns the
 * trimmed value, or null when invalid, so the editor can reject a bad
 * URL before it ever reaches a placement write.
 *
 * @param value - Raw text from the new-URL field.
 * @returns Normalised path, or null when invalid.
 */
function normaliseRouteInput(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (!trimmed.startsWith('/')) return null;
    if (/\s/.test(trimmed)) return null;
    return trimmed;
}

/* ------------------------------------------------------------------ */
/* Zone flexbox layout controls                                        */
/* ------------------------------------------------------------------ */

/**
 * Named popular layouts the preset dropdown offers, each mapping to the
 * four flex properties (gap is chosen separately, so presets leave it
 * untouched). `'custom'` is not in this map — it is the marker the UI
 * shows when the operator hand-tunes a granular control past any preset.
 */
const LAYOUT_PRESETS: Record<Exclude<ZoneLayoutPreset, 'custom'>, Omit<IZoneLayoutConfig, 'gap' | 'preset'>> = {
    'row-left': { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'nowrap' },
    'row-center': { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'nowrap' },
    'row-between': { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' },
    'row-right': { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'nowrap' },
    'row-wrap': { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'stretch', flexWrap: 'wrap' },
    'column': { flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch', flexWrap: 'nowrap' }
};

/** Preset dropdown options, in display order. */
const PRESET_OPTIONS: ReadonlyArray<{ value: ZoneLayoutPreset; label: string }> = [
    { value: 'row-left', label: 'Row — left' },
    { value: 'row-center', label: 'Row — centered' },
    { value: 'row-between', label: 'Row — space between' },
    { value: 'row-right', label: 'Row — right' },
    { value: 'row-wrap', label: 'Row — wrap' },
    { value: 'column', label: 'Column (stacked)' },
    { value: 'custom', label: 'Custom' }
];

/** Granular dropdown option lists, label → CSS value. */
const DIRECTION_OPTIONS = ['row', 'row-reverse', 'column', 'column-reverse'] as const;
const JUSTIFY_OPTIONS = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const;
const ALIGN_OPTIONS = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'] as const;
const WRAP_OPTIONS = ['nowrap', 'wrap'] as const;
const GAP_OPTIONS = ['none', 'sm', 'md', 'lg'] as const;

/**
 * Collapse-breakpoint dropdown options. The value is the
 * `ZoneCollapseBreakpoint` stored on the layout; the label spells out the
 * pixel width so an operator picks a threshold without memorising the
 * breakpoint names. `'never'` is first (the default) so an untouched
 * control reads "Never (stay a row)".
 */
const COLLAPSE_OPTIONS: ReadonlyArray<{ value: NonNullable<IZoneLayoutConfig['collapseBelow']>; label: string }> = [
    { value: 'never', label: 'Never (stay a row)' },
    { value: 'mobile-sm', label: 'Below 360px (mobile S)' },
    { value: 'mobile-md', label: 'Below 480px (mobile M)' },
    { value: 'mobile-lg', label: 'Below 768px (mobile L)' },
    { value: 'tablet', label: 'Below 1024px (tablet)' },
    { value: 'desktop', label: 'Below 1200px (desktop)' }
];

/**
 * Per-row relative-width options. The empty value clears `layoutWeight`
 * back to auto (content) width; the numbered values set the flex weight so
 * two rows at `2×` and `1×` split a row two-thirds / one-third. Kept short
 * (1×–4×) because finer ratios are rarely useful.
 */
const WIDTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'Auto' },
    { value: '1', label: '1×' },
    { value: '2', label: '2×' },
    { value: '3', label: '3×' },
    { value: '4', label: '4×' }
];

/**
 * Local-buffered textarea for a zone's custom CSS. Local state (rather than
 * committing on every keystroke like the granular selects) keeps CSS edits
 * from firing a PATCH per character; the value commits to the parent's
 * layout config on blur, only when it actually changed. Re-syncs from
 * `value` when the server truth changes underneath it (e.g. another admin
 * tab's edit lands via the websocket refetch).
 *
 * @param props.id - Element id for the textarea/label pairing.
 * @param props.value - The zone's persisted `customCss`, or empty string.
 * @param props.disabled - Whether the field is inert (busy write).
 * @param props.onCommit - Called with the new value on blur, only on change.
 */
function ZoneCustomCssField({
    id,
    value,
    disabled,
    onCommit
}: {
    id: string;
    value: string;
    disabled: boolean;
    onCommit: (css: string) => void;
}) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    return (
        <Textarea
            id={id}
            rows={4}
            value={draft}
            maxLength={4000}
            spellCheck={false}
            placeholder={'background: var(--color-surface);\nborder-bottom: var(--border-width-thin) solid var(--color-border);'}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                if (draft !== value) onCommit(draft);
            }}
        />
    );
}

/**
 * Operator-facing labels for enum values that are CSS keywords or design
 * token names. A schema enum such as `['flex-start', 'space-between']` is
 * what the renderer needs, but shown verbatim in a dropdown it reads as
 * code, and operators told us so. The persisted value is never changed —
 * only the text on the option. Values not listed here fall back to
 * sentence-casing in {@link enumOptionLabel}, so the map only needs the
 * identifiers whose plain-English reading is not obvious from the token.
 */
const ENUM_VALUE_LABELS: Readonly<Record<string, string>> = {
    'flex-start': 'Start',
    'flex-end': 'End',
    center: 'Center',
    'space-between': 'Space between',
    'space-around': 'Space around',
    'space-evenly': 'Space evenly',
    stretch: 'Stretch',
    baseline: 'Baseline',
    row: 'Row',
    'row-reverse': 'Row (reversed)',
    column: 'Column',
    'column-reverse': 'Column (reversed)',
    nowrap: 'No wrap',
    wrap: 'Wrap',
    none: 'None',
    xs: 'Extra small',
    sm: 'Small',
    md: 'Medium',
    lg: 'Large',
    xl: 'Extra large',
    'heading-xs': 'Extra small',
    'heading-sm': 'Small',
    'heading-md': 'Medium',
    'heading-lg': 'Large',
    'heading-xl': 'Extra large',
    'body-xs': 'Extra small',
    'body-sm': 'Small',
    body: 'Medium',
    'body-lg': 'Large',
    html: 'HTML',
    '2d': '2D',
    '3d': '3D'
};

/**
 * Turn one enum member into the text shown on its option or segment. Looks
 * the value up in {@link ENUM_VALUE_LABELS} first, then sentence-cases it
 * the same way {@link humanizeKey} treats a property name, so a plugin's
 * `'show_all'` reads "Show all" without the plugin declaring anything.
 * Non-string members (a numeric or boolean enum) are shown by their
 * string form, which is also how the select maps them back on change.
 *
 * @param member - One entry of the schema's `enum` array
 * @returns The label to display for that member
 */
function enumOptionLabel(member: unknown): string {
    const raw = String(member);
    const known = ENUM_VALUE_LABELS[raw];
    return known ?? humanizeKey(raw);
}

/**
 * Shared flexbox layout editor: a preset dropdown that sets the common
 * arrangements in one click, plus granular dropdowns (direction, justify,
 * align, wrap, gap, collapse threshold) for fine-tuning. Used for a zone's
 * layout on the page and, inside the placement modal, for a layout group's
 * settings — the two are the same `IZoneLayoutConfig`, and a layout group
 * edited through seven generic selects was the least friendly part of the
 * old settings form.
 *
 * Selecting a preset applies its four flex fields and keeps the chosen gap;
 * touching any granular flex field re-tags the config as `'custom'` so the
 * preset dropdown reflects that the layout no longer matches a named
 * preset. Gap and collapse are preset-independent, so changing them
 * preserves the current preset label.
 *
 * @param props.idPrefix - Prefix for control ids, unique per host so labels pair with the right control.
 * @param props.layout - The current effective layout.
 * @param props.disabled - Whether the controls are inert (busy write).
 * @param props.onChange - Receives the whole new config on every edit.
 * @param props.children - Extra host-specific controls rendered after the shared ones.
 */
function LayoutConfigControls({
    idPrefix,
    layout,
    disabled,
    onChange,
    children
}: {
    idPrefix: string;
    layout: IZoneLayoutConfig;
    disabled: boolean;
    onChange: (config: IZoneLayoutConfig) => void;
    children?: ReactNode;
}) {
    /**
     * Apply a preset: spread its flex fields over the current config,
     * keep the operator's gap, and stamp the preset name.
     *
     * @param preset - Selected preset value from the dropdown.
     */
    const applyPreset = (preset: ZoneLayoutPreset) => {
        if (preset === 'custom') {
            onChange({ ...layout, preset: 'custom' });
            return;
        }
        onChange({ ...layout, ...LAYOUT_PRESETS[preset], preset });
    };

    /**
     * Apply a granular flex change. Any granular edit re-tags the config
     * as `'custom'` (the layout no longer matches a named preset). Gap and
     * collapse are excluded — they do not belong to a preset — so changing
     * them keeps the current preset label.
     *
     * @param patch - The single field being changed.
     * @param keepPreset - True only for the gap and collapse controls.
     */
    const applyGranular = (patch: Partial<IZoneLayoutConfig>, keepPreset: boolean) => {
        onChange({ ...layout, ...patch, preset: keepPreset ? layout.preset : 'custom' });
    };

    return (
        <div className={styles.zone_layout}>
            {/* Essential controls: the preset drives the arrangement; gap and
                collapse threshold are the two operators most often touch. */}
            <div className={styles.zone_layout_group}>
                <div className={styles.zone_layout_field}>
                    <label className={styles.filter_label} htmlFor={`${idPrefix}-preset`}>Layout</label>
                    <Select
                        id={`${idPrefix}-preset`}
                        value={layout.preset ?? 'custom'}
                        onChange={(e) => applyPreset(e.target.value as ZoneLayoutPreset)}
                        disabled={disabled}
                    >
                        {PRESET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                </div>
                <div className={styles.zone_layout_field}>
                    <label className={styles.filter_label} htmlFor={`${idPrefix}-gap`}>Gap</label>
                    <Select
                        id={`${idPrefix}-gap`}
                        value={layout.gap}
                        onChange={(e) => applyGranular({ gap: e.target.value as IZoneLayoutConfig['gap'] }, true)}
                        disabled={disabled}
                    >
                        {GAP_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                    </Select>
                </div>
                <div className={styles.zone_layout_field}>
                    <label className={styles.filter_label} htmlFor={`${idPrefix}-collapse`}>Collapse</label>
                    <Select
                        id={`${idPrefix}-collapse`}
                        value={layout.collapseBelow ?? 'never'}
                        onChange={(e) => applyGranular({ collapseBelow: e.target.value as IZoneLayoutConfig['collapseBelow'] }, true)}
                        disabled={disabled}
                    >
                        {COLLAPSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                </div>
            </div>

            {/* Fine-tune: the four flex axes the preset normally sets. Grouped
                under a label so an operator reads them as the advanced tier
                rather than peers of the preset. */}
            <div className={styles.zone_layout_advanced}>
                <span className={styles.zone_layout_advanced_label}>Fine-tune arrangement</span>
                <div className={styles.zone_layout_group}>
                    <div className={styles.zone_layout_field}>
                        <label className={styles.filter_label} htmlFor={`${idPrefix}-dir`}>Direction</label>
                        <Select
                            id={`${idPrefix}-dir`}
                            value={layout.flexDirection}
                            onChange={(e) => applyGranular({ flexDirection: e.target.value as IZoneLayoutConfig['flexDirection'] }, false)}
                            disabled={disabled}
                        >
                            {DIRECTION_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                        </Select>
                    </div>
                    <div className={styles.zone_layout_field}>
                        <label className={styles.filter_label} htmlFor={`${idPrefix}-justify`}>Justify</label>
                        <Select
                            id={`${idPrefix}-justify`}
                            value={layout.justifyContent}
                            onChange={(e) => applyGranular({ justifyContent: e.target.value as IZoneLayoutConfig['justifyContent'] }, false)}
                            disabled={disabled}
                        >
                            {JUSTIFY_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                        </Select>
                    </div>
                    <div className={styles.zone_layout_field}>
                        <label className={styles.filter_label} htmlFor={`${idPrefix}-align`}>Align</label>
                        <Select
                            id={`${idPrefix}-align`}
                            value={layout.alignItems}
                            onChange={(e) => applyGranular({ alignItems: e.target.value as IZoneLayoutConfig['alignItems'] }, false)}
                            disabled={disabled}
                        >
                            {ALIGN_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                        </Select>
                    </div>
                    <div className={styles.zone_layout_field}>
                        <label className={styles.filter_label} htmlFor={`${idPrefix}-wrap`}>Wrap</label>
                        <Select
                            id={`${idPrefix}-wrap`}
                            value={layout.flexWrap}
                            onChange={(e) => applyGranular({ flexWrap: e.target.value as IZoneLayoutConfig['flexWrap'] }, false)}
                            disabled={disabled}
                        >
                            {WRAP_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                        </Select>
                    </div>
                </div>
            </div>

            {children}
        </div>
    );
}

/**
 * Per-zone flexbox controls: the shared {@link LayoutConfigControls} plus
 * the custom CSS block, which only a zone supports (a layout group's
 * config schema has no `customCss`). Wires the zone id into the control
 * ids and into the change callback so the page can persist per zone.
 *
 * @param props.zoneId - Zone these controls edit.
 * @param props.layout - The zone's current effective layout.
 * @param props.disabled - Whether the controls are inert (busy write).
 * @param props.onChange - Persists the new config for the zone.
 */
function ZoneLayoutControls({
    zoneId,
    layout,
    disabled,
    onChange
}: {
    zoneId: string;
    layout: IZoneLayoutConfig;
    disabled: boolean;
    onChange: (zoneId: string, config: IZoneLayoutConfig) => void;
}) {
    return (
        <LayoutConfigControls
            idPrefix={`zl-${zoneId}`}
            layout={layout}
            disabled={disabled}
            onChange={(config) => onChange(zoneId, config)}
        >
            {/* Custom CSS: declarations only, applied to the zone container
                as `[data-zone="<id>"] { <css> }` at SSR — mirrors how theme
                CSS is injected, validated server-side (PostCSS syntax check)
                before it persists. */}
            <div className={styles.zone_layout_advanced}>
                <span className={styles.zone_layout_advanced_label}>Custom CSS</span>
                <ZoneCustomCssField
                    id={`zl-${zoneId}-css`}
                    value={layout.customCss ?? ''}
                    disabled={disabled}
                    onCommit={(css) => onChange(zoneId, { ...layout, customCss: css.trim().length > 0 ? css : undefined })}
                />
                <span className={styles.filter_label}>
                    Declarations only — no selector. Applied as <code>[data-zone=&quot;{zoneId}&quot;] {'{ ... }'}</code>.
                </span>
            </div>
        </LayoutConfigControls>
    );
}

/**
 * Top-level admin page rendering the placement editor.
 */
export default function WidgetsAdminPage() {
    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    const [zones, setZones] = useState<IZoneSnapshot | null>(null);
    const [types, setTypes] = useState<IWidgetTypeSnapshot | null>(null);
    const [placements, setPlacements] = useState<IPlacement[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    // URL-centric editing. `selectedRoute` is null before any selection;
    // in that state the editor shows every zone with only its global
    // (no-route-filter) placements so site-wide widgets stay manageable
    // without first picking a page. Selecting a URL narrows each zone to
    // the placements that resolve on it. `customRoutes` holds URLs the
    // operator typed in the new-URL box that no placement targets yet, so
    // they remain selectable until a widget is placed on them.
    const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
    const [newRouteDraft, setNewRouteDraft] = useState<string>('');
    const [customRoutes, setCustomRoutes] = useState<string[]>([]);

    const notifyError = useCallback(
        (title: string, err: unknown) => {
            pushToast({
                tone: 'danger',
                title,
                description: err instanceof Error ? err.message : String(err)
            });
        },
        [pushToast]
    );

    const notifySuccess = useCallback(
        (title: string) => pushToast({ tone: 'success', title }),
        [pushToast]
    );

    /**
     * Fetch the three snapshots needed to render the page. The
     * loading flag is only set on first-load; refetches triggered by
     * WebSocket events do not flash a loading state.
     */
    const fetchAll = useCallback(
        async (firstLoad: boolean): Promise<void> => {
            if (firstLoad) setLoading(true);
            setError(null);
            try {
                const [zonesRes, typesRes, placementsRes] = await Promise.all([
                    fetch('/api/admin/system/zones'),
                    fetch('/api/admin/system/widget-types'),
                    fetch('/api/admin/system/widgets/placements')
                ]);
                if (!zonesRes.ok) throw new Error(`Failed to load zones (${zonesRes.status})`);
                if (!typesRes.ok) throw new Error(`Failed to load widget types (${typesRes.status})`);
                if (!placementsRes.ok) throw new Error(`Failed to load placements (${placementsRes.status})`);
                const [zonesData, typesData, placementsData] = await Promise.all([
                    zonesRes.json(),
                    typesRes.json(),
                    placementsRes.json()
                ]);
                setZones(zonesData as IZoneSnapshot);
                setTypes(typesData as IWidgetTypeSnapshot);
                setPlacements((placementsData.placements ?? []) as IPlacement[]);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (firstLoad) setLoading(false);
            }
        },
        []
    );

    /* Initial load. */
    useEffect(() => {
        void fetchAll(true);
    }, [fetchAll]);

    /* WebSocket refetch trigger. */
    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void fetchAll(false); };
        socket.on('widgets:placements-update', handler);
        return () => {
            socket.off('widgets:placements-update', handler);
        };
    }, [fetchAll]);

    /**
     * PATCH a single placement, throwing on failure.
     *
     * The modal-edit path awaits this directly and lets the outer
     * try/catch handle the failure UX (toast + keep modal open). The
     * row-level enable switch goes through `togglePlacement` instead,
     * which adds the standalone toast UX.
     */
    const patchPlacement = useCallback(
        async (id: string, patch: IPlacementPatch): Promise<void> => {
            const res = await fetch(`/api/admin/system/widgets/placements/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch)
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(formatApiError(body, res.status, 'Update'));
            }
        },
        []
    );

    /**
     * Toast-wrapping wrapper for the inline enable switch and any
     * other standalone-row mutation. Toasts success or failure and
     * never throws, since the callers (Switch's `onChange`) have
     * nowhere to surface the error.
     */
    const togglePlacement = useCallback(
        async (id: string, patch: IPlacementPatch): Promise<void> => {
            setBusyId(id);
            try {
                await patchPlacement(id, patch);
                notifySuccess('Placement updated');
            } catch (err) {
                notifyError('Could not update placement', err);
            } finally {
                setBusyId(null);
            }
        },
        [patchPlacement, notifyError, notifySuccess]
    );

    /**
     * Create a new operator-source placement.
     */
    const createPlacement = useCallback(
        async (input: IPlacementCreate): Promise<void> => {
            const res = await fetch('/api/admin/system/widgets/placements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input)
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(formatApiError(body, res.status, 'Create'));
            }
        },
        []
    );

    /**
     * Delete an operator-source placement.
     */
    const deletePlacement = useCallback(
        async (id: string): Promise<void> => {
            const res = await fetch(`/api/admin/system/widgets/placements/${id}`, {
                method: 'DELETE'
            });
            if (!res.ok && res.status !== 204) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Delete failed (${res.status})`);
            }
        },
        []
    );

    /**
     * Restore plugin defaults on a plugin-source placement.
     */
    const restoreDefaults = useCallback(
        async (id: string): Promise<void> => {
            setBusyId(id);
            try {
                const res = await fetch(`/api/admin/system/widgets/placements/${id}/restore-defaults`, {
                    method: 'POST'
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `Restore failed (${res.status})`);
                }
                notifySuccess('Plugin defaults restored');
            } catch (err) {
                notifyError('Could not restore defaults', err);
            } finally {
                setBusyId(null);
            }
        },
        [notifyError, notifySuccess]
    );

    /**
     * Persist a zone's flexbox layout. Updates the local zone snapshot
     * optimistically so the editor (and the live preview a refetch would
     * bring) reflects the change immediately, then PATCHes the zone-layout
     * endpoint. A failed write reverts by refetching the server truth.
     */
    const setZoneLayout = useCallback(
        async (zoneId: string, config: IZoneLayoutConfig): Promise<void> => {
            setZones(prev =>
                prev
                    ? {
                        tracks: prev.tracks.map(track => ({
                            ...track,
                            zones: track.zones.map(zone =>
                                zone.id === zoneId ? { ...zone, layoutConfig: config } : zone
                            )
                        }))
                    }
                    : prev
            );
            try {
                const res = await fetch(`/api/admin/system/zones/${encodeURIComponent(zoneId)}/layout`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `Layout update failed (${res.status})`);
                }
                notifySuccess('Zone layout updated');
            } catch (err) {
                notifyError('Could not update zone layout', err);
                void fetchAll(false);
            }
        },
        [notifyError, notifySuccess, fetchAll]
    );

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    /**
     * Collision strategy that lets the thin top-level "gap rails" win over the
     * layout-group drop region they sit beside.
     *
     * A group's children region physically wraps the space directly under its
     * container bubble, so the default `closestCorners` resolves a drag aimed
     * just below the group to the group itself — re-nesting the widget instead
     * of placing it below at the zone level. A gap rail is small, so it should
     * only claim a drop when the pointer is literally inside it; we honour that
     * by returning a gap hit from `pointerWithin` first and falling back to
     * `closestCorners` everywhere else, leaving every other drop unchanged.
     *
     * @param args - dnd-kit collision arguments (droppable rects, pointer).
     * @returns The single gap collision when the pointer is within one, else
     *   the `closestCorners` result.
     */
    const collisionDetection = useCallback(
        (args: Parameters<typeof closestCorners>[0]) => {
            const gapHit = pointerWithin(args).find(hit => String(hit.id).startsWith('gap:'));
            return gapHit ? [gapHit] : closestCorners(args);
        },
        []
    );

    /**
     * Whether a placement belongs to the list the operator is currently
     * viewing. Only top-level zone lists are route-scoped, so a route filter
     * must not renumber rows the operator cannot see; a container's children
     * carry no route filter of their own and are always their full set.
     *
     * @param p - The placement to test against the active route filter.
     * @returns True when the row is visible under the current route selection.
     */
    const placementVisibleInView = useCallback(
        (p: IPlacement): boolean =>
            selectedRoute === null
                ? p.routes.length === 0
                : placementMatchesRoute(p.routes, selectedRoute),
        [selectedRoute]
    );

    /**
     * The ordered sibling list a row lives in — a container's children when
     * `containerId` is set, otherwise the zone's visible top-level rows.
     * Shared by drag-end, the gap rails, and the explicit move buttons so all
     * three reorder against exactly the same list and ordering.
     *
     * @param containerId - Layout-group id for a child list, or null for the
     *   zone's top-level list.
     * @param zoneId - Zone whose top-level rows to gather (ignored for a child
     *   list, which is keyed solely by container).
     * @returns The matching placements sorted ascending by `order`.
     */
    const siblingList = useCallback(
        (containerId: string | null, zoneId: string): IPlacement[] =>
            (containerId
                ? placements.filter(p => p.parentId === containerId)
                : placements.filter(p => !p.parentId && p.zoneId === zoneId && placementVisibleInView(p))
            ).sort((a, b) => a.order - b.order),
        [placements, placementVisibleInView]
    );

    /**
     * Move a placement into a destination list and persist the result — the
     * shared engine behind drag-drop, the gap rails, and the move buttons.
     * Computes the source and (on a cross-list move) destination lists, inserts
     * the row at the index the caller resolves, then renumbers each affected
     * list sequentially (10, 20, 30…). The moved row additionally gets a
     * `parentId` patch when its container changed (a string attaches — the
     * backend then forces its zone and clears its routes — `null` detaches)
     * and a `zoneId` patch on a plain zone move. The list updates optimistically
     * so the row snaps into place; a failed PATCH falls back to a refetch.
     *
     * @param moved - The placement being relocated.
     * @param requestedContainer - Destination layout-group id, or null for the
     *   zone top level. Forced to null for a layout group (groups never nest)
     *   and a no-op when it names the moved row itself.
     * @param destZone - Destination zone id for the row.
     * @param resolveInsertIdx - Given the destination list with the moved row
     *   already excluded, returns the index to insert at. Callers express
     *   intent (before a neighbour, after a container, append) without
     *   duplicating the renumber logic.
     */
    const applyMove = useCallback(
        async (
            moved: IPlacement,
            requestedContainer: string | null,
            destZone: string,
            resolveInsertIdx: (destListPrev: IPlacement[]) => number
        ): Promise<void> => {
            // A layout group is always top-level — never nest one. Dropping a
            // container onto its own children region is a no-op.
            const destContainerId = moved.typeId === LAYOUT_GROUP_TYPE_ID ? null : requestedContainer;
            if (destContainerId === moved.id) return;

            const sourceContainerId = moved.parentId ?? null;
            const srcKey = sourceContainerId ? `c:${sourceContainerId}` : `z:${moved.zoneId}`;
            const dstKey = destContainerId ? `c:${destContainerId}` : `z:${destZone}`;
            const sameList = srcKey === dstKey;

            const sourceList = siblingList(sourceContainerId, moved.zoneId);
            const sourceWithoutActive = sourceList.filter(p => p.id !== moved.id);
            const destListPrev = sameList ? sourceWithoutActive : siblingList(destContainerId, destZone);

            const insertIdx = Math.max(0, Math.min(resolveInsertIdx(destListPrev), destListPrev.length));

            const movedNext: IPlacement = {
                ...moved,
                parentId: destContainerId ?? undefined,
                zoneId: destZone
            };
            const newDest = [
                ...destListPrev.slice(0, insertIdx),
                movedNext,
                ...destListPrev.slice(insertIdx)
            ];
            const newSource = sameList ? newDest : sourceWithoutActive;

            const parentChanged = (moved.parentId ?? null) !== destContainerId;
            const zoneChanged = moved.zoneId !== destZone;

            interface IOp { id: string; patch: IPlacementPatch }
            const ops: IOp[] = [];
            newDest.forEach((p, idx) => {
                const nextOrder = (idx + 1) * 10;
                const patch: IPlacementPatch = {};
                if (p.order !== nextOrder) patch.order = nextOrder;
                if (p.id === moved.id) {
                    if (parentChanged) {
                        // Attach (string) or detach (null). On attach the
                        // backend forces the child's zone and clears its
                        // routes, so an explicit zoneId is unnecessary.
                        patch.parentId = destContainerId;
                    }
                    if (destContainerId === null && zoneChanged) {
                        patch.zoneId = destZone;
                    }
                }
                if (Object.keys(patch).length > 0) ops.push({ id: p.id, patch });
            });
            if (!sameList) {
                newSource.forEach((p, idx) => {
                    const nextOrder = (idx + 1) * 10;
                    if (p.order !== nextOrder) ops.push({ id: p.id, patch: { order: nextOrder } });
                });
            }

            if (ops.length === 0) return;

            setPlacements(prev => {
                const byId = new Map(prev.map(p => [p.id, p]));
                for (const op of ops) {
                    const existing = byId.get(op.id);
                    if (!existing) continue;
                    const next: IPlacement = { ...existing };
                    if (op.patch.order !== undefined) next.order = op.patch.order;
                    if (op.patch.zoneId !== undefined) next.zoneId = op.patch.zoneId;
                    if (op.patch.parentId !== undefined) {
                        if (op.patch.parentId === null) {
                            next.parentId = undefined;
                        } else {
                            next.parentId = op.patch.parentId;
                            next.zoneId = destZone;
                            next.routes = [];
                        }
                    }
                    byId.set(op.id, next);
                }
                return Array.from(byId.values());
            });

            try {
                await Promise.all(ops.map(op => patchPlacement(op.id, op.patch)));
            } catch (err) {
                notifyError('Could not move placement', err);
                void fetchAll(false);
            }
        },
        [siblingList, patchPlacement, notifyError, fetchAll]
    );

    /**
     * Translate a drag-end gesture into an `applyMove` call. The drop target
     * decides the destination: a gap rail (`kind: 'gap'`) inserts at the zone
     * top level before its anchor row; a container's children region or a child
     * row nests into that container; a zone or a top-level item places directly
     * in the zone, detaching the row if it was nested.
     *
     * @param event - dnd-kit drag-end event carrying the active and over nodes.
     */
    const handleDragEnd = useCallback(
        async (event: DragEndEvent): Promise<void> => {
            const { active, over } = event;
            if (!over) return;
            const moved = placements.find(p => p.id === String(active.id));
            if (!moved) return;

            const overData = over.data.current ?? {};

            // A gap rail: a top-level insertion anchored before a specific row
            // (or appended when its anchor is the trailing `end` rail).
            // Resolving by the neighbour id keeps the index correct after the
            // moved row is excluded from the destination list.
            if (overData.kind === 'gap') {
                const destZone = overData.zoneId as string;
                const beforeId = overData.beforeId as string | null;
                // A row dropped on its own leading rail (the rail directly above
                // it) inserts itself before itself — its slot never changes.
                // `applyMove` filters the moved row out of `destListPrev`, so the
                // anchor lookup below would miss and append it to the zone end;
                // short-circuit to a true no-op instead.
                if (beforeId === moved.id) return;
                await applyMove(moved, null, destZone, destListPrev => {
                    if (beforeId === null) return destListPrev.length;
                    const i = destListPrev.findIndex(p => p.id === beforeId);
                    return i < 0 ? destListPrev.length : i;
                });
                return;
            }

            // Resolve the destination list. A container drop region and a
            // child row both name a container; anything else (zone droppable
            // or top-level item) targets a zone directly.
            let destContainerId: string | null = null;
            let destZone: string | undefined;
            if (typeof overData.containerId === 'string') {
                destContainerId = overData.containerId;
                destZone = overData.zoneId as string | undefined;
            } else if (typeof overData.parentId === 'string') {
                destContainerId = overData.parentId;
                destZone = overData.zoneId as string | undefined;
            } else {
                destZone = (overData.zoneId as string | undefined) ?? String(over.id);
            }
            if (!destZone) return;

            // Guard the self-drop: hovering a row's own slot resolves `over` to
            // the moved row, which would otherwise append it to the list end.
            const sourceContainerId = moved.parentId ?? null;
            const sameList = (sourceContainerId ? `c:${sourceContainerId}` : `z:${moved.zoneId}`)
                === (destContainerId ? `c:${destContainerId}` : `z:${destZone}`);
            if (active.id === over.id && sameList) return;

            const overIsArea =
                typeof overData.containerId === 'string' || String(over.id) === destZone;
            await applyMove(moved, destContainerId, destZone, destListPrev => {
                if (overIsArea) return destListPrev.length;
                const target = destListPrev.findIndex(p => p.id === String(over.id));
                return target < 0 ? destListPrev.length : target;
            });
        },
        [placements, applyMove]
    );

    /**
     * Reorder a row one step within its current list (its layout group when
     * nested, otherwise the zone's top-level list). Backs the up/down buttons
     * that give a precise, keyboard-accessible alternative to dragging — the
     * gesture hardest to land cleanly around a layout group.
     *
     * @param moved - The row to nudge.
     * @param direction - 'up' moves it before its predecessor, 'down' after its
     *   successor; boundary steps are ignored.
     */
    const moveWithinList = useCallback(
        (moved: IPlacement, direction: 'up' | 'down'): void => {
            const containerId = moved.parentId ?? null;
            const list = siblingList(containerId, moved.zoneId);
            const currentIdx = list.findIndex(p => p.id === moved.id);
            if (currentIdx < 0) return;
            const targetIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
            if (targetIdx < 0 || targetIdx >= list.length) return;
            void applyMove(moved, containerId, moved.zoneId, () => targetIdx);
        },
        [siblingList, applyMove]
    );

    /**
     * Promote a nested child out of its layout group to the zone's top level,
     * positioned immediately after its former container so it reads as "just
     * below the group" — the exact move drag-and-drop makes cumbersome because
     * the group's drop region owns the space beneath it.
     *
     * @param moved - The nested child to detach; a no-op if already top-level.
     */
    const moveOutOfGroup = useCallback(
        (moved: IPlacement): void => {
            const containerId = moved.parentId ?? null;
            if (!containerId) return;
            const topList = siblingList(null, moved.zoneId);
            const containerIdx = topList.findIndex(p => p.id === containerId);
            const insertIdx = containerIdx < 0 ? topList.length : containerIdx + 1;
            void applyMove(moved, null, moved.zoneId, () => insertIdx);
        },
        [siblingList, applyMove]
    );

    /**
     * Distinct page URLs operators can filter by — every route already
     * assigned to a placement, plus any the operator typed in the
     * new-URL box. Empty `routes` (global placements) contribute no URL
     * since they target every path; they surface under whichever URL is
     * selected via the route matcher. Sorted for a stable dropdown.
     */
    const routeOptions = useMemo(() => {
        const set = new Set<string>(customRoutes);
        for (const placement of placements) {
            for (const route of placement.routes) set.add(route);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [placements, customRoutes]);

    /**
     * Group placements by zone for rendering. With a URL selected, each
     * zone lists the placements whose route filter matches that URL
     * (exact, glob, or global). With no URL selected the editor shows the
     * unfiltered catalog: every zone with only its *global* placements —
     * those carrying no route filter (`routes: []`) — so an operator can
     * see and manage site-wide widgets without first picking a page.
     * Route-scoped placements stay hidden in that mode because they
     * belong to a specific URL. Empty zones still render so operators see
     * the full target set.
     */
    const grouped = useMemo(() => {
        if (!zones) return [] as Array<{ trackId: string; trackLabel: string; rows: Array<{ zoneId: string; zoneLabel: string; layoutConfig: IZoneLayoutConfig; placements: IPlacement[] }> }>;
        const byZone = new Map<string, IPlacement[]>();
        for (const placement of placements) {
            const matches = selectedRoute === null
                ? placement.routes.length === 0
                : placementMatchesRoute(placement.routes, selectedRoute);
            if (!matches) continue;
            const bucket = byZone.get(placement.zoneId) ?? [];
            bucket.push(placement);
            byZone.set(placement.zoneId, bucket);
        }
        for (const bucket of byZone.values()) {
            bucket.sort((a, b) => a.order - b.order);
        }
        return zones.tracks.map(track => ({
            trackId: track.id,
            trackLabel: track.label,
            rows: track.zones.map(zone => ({
                zoneId: zone.id,
                zoneLabel: zone.label,
                layoutConfig: zone.layoutConfig,
                placements: byZone.get(zone.id) ?? []
            }))
        }));
    }, [zones, placements, selectedRoute]);

    /**
     * Commit the new-URL field: validate it, register it as a selectable
     * URL, and switch the editor to it so the operator can immediately
     * place widgets on that page. Invalid input raises a toast rather
     * than silently failing.
     */
    const saveNewRoute = useCallback(() => {
        const normalised = normaliseRouteInput(newRouteDraft);
        if (!normalised) {
            pushToast({
                tone: 'danger',
                title: 'Invalid URL',
                description: 'Enter a root-relative path beginning with “/”, e.g. /markets.'
            });
            return;
        }
        setCustomRoutes(prev => (prev.includes(normalised) ? prev : [...prev, normalised]));
        setSelectedRoute(normalised);
        setNewRouteDraft('');
    }, [newRouteDraft, pushToast]);

    /**
     * Open the create/edit form modal.
     */
    const openPlacementModal = useCallback(
        (mode: 'create' | 'edit', initial?: IPlacement, defaultRoute?: string) => {
            const id = openModal({
                title: mode === 'create' ? 'Place widget' : 'Edit widget',
                size: 'md',
                content: (
                    <PlacementForm
                        mode={mode}
                        initial={initial}
                        defaultRoutes={defaultRoute ? [defaultRoute] : undefined}
                        types={types}
                        zones={zones}
                        placements={placements}
                        onCancel={() => closeModal(id)}
                        onSubmit={async (data) => {
                            try {
                                if (mode === 'create') {
                                    await createPlacement(data as IPlacementCreate);
                                    notifySuccess('Placement created');
                                } else if (initial) {
                                    await patchPlacement(initial.id, data as IPlacementPatch);
                                    notifySuccess('Placement updated');
                                }
                                closeModal(id);
                            } catch (err) {
                                notifyError(
                                    mode === 'create' ? 'Could not create placement' : 'Could not update placement',
                                    err
                                );
                            }
                        }}
                    />
                )
            });
        },
        [
            closeModal,
            createPlacement,
            notifyError,
            notifySuccess,
            openModal,
            patchPlacement,
            placements,
            types,
            zones
        ]
    );

    /**
     * Open the delete-confirm modal. Plugin-source rows are not
     * deletable — the delete button is hidden for those, but if
     * somehow invoked the dialog explains the constraint.
     */
    const openDeleteModal = useCallback(
        (placement: IPlacement) => {
            const isPluginSource = placement.source === 'plugin';
            const id = openModal({
                title: 'Delete widget',
                size: 'sm',
                content: (
                    <ConfirmDialog
                        label={placement.title ?? placement.typeId}
                        message={
                            isPluginSource
                                ? 'Plugin-placed widgets cannot be deleted. Disable the widget or restore plugin defaults instead.'
                                : undefined
                        }
                        confirmLabel="Delete"
                        onCancel={() => closeModal(id)}
                        onConfirm={async () => {
                            if (isPluginSource) {
                                closeModal(id);
                                return;
                            }
                            try {
                                await deletePlacement(placement.id);
                                notifySuccess('Placement deleted');
                                closeModal(id);
                            } catch (err) {
                                notifyError('Could not delete placement', err);
                            }
                        }}
                    />
                )
            });
        },
        [closeModal, deletePlacement, notifyError, notifySuccess, openModal]
    );

    return (
        <Page>
            <div className={styles.container}>
                <PageHeader
                    title="Widget Placements"
                    subtitle="Where plugin widgets appear, in what order, and on which routes."
                />

                <Stack gap="lg">
                    <div className={styles.toolbar}>
                        <p className="text-muted">
                            Widgets reach a zone two ways. <strong>Plugin-placed</strong> rows are added
                            automatically by the plugin that owns the widget — you can disable or edit them,
                            and your changes survive the plugin being turned off and back on.
                            {' '}<strong>Operator-placed</strong> rows are ones you add here yourself with
                            {' '}<strong>Place widget</strong> — disable, edit, or delete them freely.
                        </p>
                        <Button
                            variant="primary"
                            icon={<Plus size={16} />}
                            onClick={() => openPlacementModal('create', undefined, selectedRoute ?? undefined)}
                            disabled={!zones || !types}
                        >
                            Place widget
                        </Button>
                    </div>

                    {!loading && (
                        <div className={styles.filter_bar}>
                            <div className={styles.filter_field}>
                                <label className={styles.filter_label} htmlFor="wp-route-filter">
                                    Page URL
                                </label>
                                <Select
                                    id="wp-route-filter"
                                    value={selectedRoute ?? ''}
                                    onChange={(e) => setSelectedRoute(e.target.value === '' ? null : e.target.value)}
                                >
                                    <option value="">All pages (no route filter)</option>
                                    {routeOptions.map(route => (
                                        <option key={route} value={route}>{route}</option>
                                    ))}
                                </Select>
                            </div>
                            <div className={styles.new_route_group}>
                                <div className={styles.filter_field}>
                                    <label className={styles.filter_label} htmlFor="wp-route-new">
                                        New page URL
                                    </label>
                                    <Input
                                        id="wp-route-new"
                                        type="text"
                                        placeholder="/markets"
                                        value={newRouteDraft}
                                        onChange={(e) => setNewRouteDraft(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNewRoute(); } }}
                                    />
                                </div>
                                <Button
                                    variant="secondary"
                                    onClick={saveNewRoute}
                                    disabled={newRouteDraft.trim().length === 0}
                                >
                                    Save
                                </Button>
                            </div>
                        </div>
                    )}

                    {error && <div className="alert" role="alert">{error}</div>}

                    {loading && (
                        <p className="text-muted">Loading placement editor&hellip;</p>
                    )}

                    {!loading && !zones && (
                        <p className="text-muted">No zones declared.</p>
                    )}

                    {!loading && zones && selectedRoute === null && (
                        <p className={`text-muted ${styles.route_gate}`}>
                            Showing site-wide widgets (no route filter). Select a page URL above — or add a
                            new one — to view and manage that page&rsquo;s widgets.
                        </p>
                    )}

                    {!loading && zones && (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={collisionDetection}
                            onDragEnd={handleDragEnd}
                        >
                            {grouped.map(track => (
                                <section key={track.trackId} className={styles.track}>
                                    <h2 className={styles.track_title}>{track.trackLabel}</h2>
                                    <div className={styles.zone_list}>
                                        {track.rows.map(zone => (
                                            <ZoneSection
                                                key={zone.zoneId}
                                                zoneId={zone.zoneId}
                                                zoneLabel={zone.zoneLabel}
                                                layoutConfig={zone.layoutConfig}
                                                placements={zone.placements}
                                                types={types}
                                                zones={zones}
                                                busyId={busyId}
                                                onToggleEnabled={(p, next) => togglePlacement(p.id, { enabled: next })}
                                                onEdit={(p) => openPlacementModal('edit', p)}
                                                onDelete={openDeleteModal}
                                                onRestore={(p) => restoreDefaults(p.id)}
                                                onSetWidth={(p, weight) => togglePlacement(p.id, { layoutWeight: weight })}
                                                onLayoutChange={setZoneLayout}
                                                onMoveWithinList={moveWithinList}
                                                onMoveOutOfGroup={moveOutOfGroup}
                                            />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </DndContext>
                    )}
                </Stack>
            </div>
        </Page>
    );
}

/* ------------------------------------------------------------------ */
/* Zone section                                                        */
/* ------------------------------------------------------------------ */

interface ZoneSectionProps {
    zoneId: string;
    zoneLabel: string;
    layoutConfig: IZoneLayoutConfig;
    placements: IPlacement[];
    types: IWidgetTypeSnapshot | null;
    zones: IZoneSnapshot | null;
    busyId: string | null;
    onToggleEnabled: (placement: IPlacement, next: boolean) => void;
    onEdit: (placement: IPlacement) => void;
    onDelete: (placement: IPlacement) => void;
    onRestore: (placement: IPlacement) => void;
    onSetWidth: (placement: IPlacement, weight: number | null) => void;
    onLayoutChange: (zoneId: string, config: IZoneLayoutConfig) => void;
    /** Reorder a row one step within its current list (zone or group). */
    onMoveWithinList: (placement: IPlacement, direction: 'up' | 'down') => void;
    /** Promote a nested child to the zone top level, just below its group. */
    onMoveOutOfGroup: (placement: IPlacement) => void;
}

/**
 * One zone: a drop target holding its placements, with the zone's flexbox
 * layout controls tucked behind a collapsed disclosure in the header.
 *
 * The layout controls are an occasional, advanced task — surfacing all seven
 * selects on every zone at once buried the actual placements in control noise.
 * Collapsing them (with the active preset name shown on the toggle so the
 * current arrangement stays legible while closed) keeps the scannable content —
 * the widgets and their order — front and centre, and lets an operator open the
 * controls only for the zone they are tuning.
 */
function ZoneSection({
    zoneId,
    zoneLabel,
    layoutConfig,
    placements,
    types,
    zones,
    busyId,
    onToggleEnabled,
    onEdit,
    onDelete,
    onRestore,
    onSetWidth,
    onLayoutChange,
    onMoveWithinList,
    onMoveOutOfGroup
}: ZoneSectionProps) {
    const zoneInfo = lookupZone(zones, zoneId);
    const { setNodeRef, isOver } = useDroppable({ id: zoneId, data: { zoneId } });

    // Layout controls collapse by default; the operator opens them per-zone.
    const [layoutOpen, setLayoutOpen] = useState(false);

    // Human-readable name of the zone's active preset, shown on the toggle so
    // a custom or non-default arrangement stays visible while the panel is shut.
    const presetLabel = useMemo(() => {
        const match = PRESET_OPTIONS.find(o => o.value === (layoutConfig.preset ?? 'custom'));
        return match ? match.label : 'Custom';
    }, [layoutConfig.preset]);

    // Relative width is a flex weight, so it only takes effect when the zone
    // arranges its top-level rows along a row axis. In a column it is inert, so
    // the inline width control is suppressed for those rows.
    const zoneIsRow = layoutConfig.flexDirection === 'row' || layoutConfig.flexDirection === 'row-reverse';

    // Split the zone's placements into the top-level rows (drawn in the
    // sortable list) and the children nested inside layout-group
    // containers. Only top-level rows participate in drag-reorder; a
    // child's container and order are edited from the modal instead.
    const topLevel = useMemo(() => placements.filter(p => !p.parentId), [placements]);
    const childrenByParent = useMemo(() => {
        const map = new Map<string, IPlacement[]>();
        for (const p of placements) {
            if (!p.parentId) continue;
            const bucket = map.get(p.parentId) ?? [];
            bucket.push(p);
            map.set(p.parentId, bucket);
        }
        for (const bucket of map.values()) {
            bucket.sort((a, b) => a.order - b.order);
        }
        return map;
    }, [placements]);
    const itemIds = useMemo(() => topLevel.map(p => p.id), [topLevel]);

    return (
        <section className={cn(styles.zone, isOver && styles['zone--drop-target'])}>
            <header className={styles.zone_header}>
                <h3 className={styles.zone_label}>
                    {zoneLabel}
                    <span className={styles.zone_id}>{zoneId}</span>
                </h3>
                {zoneInfo && <Badge tone="neutral">{zoneInfo.host}</Badge>}
                <div className={styles.zone_header_meta}>
                    <span className={styles.zone_count}>
                        {placements.length} {placements.length === 1 ? 'placement' : 'placements'}
                    </span>
                    <button
                        type="button"
                        className={cn(styles.layout_toggle, layoutOpen && styles['layout_toggle--open'])}
                        onClick={() => setLayoutOpen(open => !open)}
                        aria-expanded={layoutOpen}
                        aria-label={`${layoutOpen ? 'Hide' : 'Show'} layout controls for ${zoneLabel}`}
                    >
                        <SlidersHorizontal size={14} aria-hidden />
                        <span className={styles.layout_toggle_text}>Layout</span>
                        <span className={styles.layout_toggle_preset}>{presetLabel}</span>
                        {layoutOpen
                            ? <ChevronUp size={14} aria-hidden />
                            : <ChevronDown size={14} aria-hidden />}
                    </button>
                </div>
            </header>

            {layoutOpen && (
                <ZoneLayoutControls
                    zoneId={zoneId}
                    layout={layoutConfig}
                    disabled={busyId !== null}
                    onChange={onLayoutChange}
                />
            )}

            <SortableContext id={zoneId} items={itemIds} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className={styles.bubbles}>
                    {topLevel.length === 0 ? (
                        <p className={styles.zone_empty}>
                            No placements in this zone — drag a widget here to place it.
                        </p>
                    ) : (
                        <>
                            {topLevel.map((placement, index) => {
                                const isContainer = placement.typeId === LAYOUT_GROUP_TYPE_ID;
                                const kids = isContainer
                                    ? childrenByParent.get(placement.id) ?? []
                                    : [];
                                // A layout group carries its own arrangement in its
                                // instanceConfig (default column); its children's
                                // width control follows that, not the zone's.
                                const groupDirection = placement.instanceConfig?.flexDirection;
                                const groupIsRow = groupDirection === 'row' || groupDirection === 'row-reverse';
                                return (
                                    <Fragment key={placement.id}>
                                        {/* Top-level insertion rail before this row. The
                                            rail before the row after a group is the
                                            "drop below the group" target; the rail before
                                            a container is the "drop above the group" one. */}
                                        <GapRail zoneId={zoneId} beforeId={placement.id} />
                                        <PlacementBubble
                                            placement={placement}
                                            typeInfo={lookupType(types, placement.typeId)}
                                            busy={busyId === placement.id}
                                            showWidth={zoneIsRow}
                                            isFirst={index === 0}
                                            isLast={index === topLevel.length - 1}
                                            onMoveUp={() => onMoveWithinList(placement, 'up')}
                                            onMoveDown={() => onMoveWithinList(placement, 'down')}
                                            onToggleEnabled={onToggleEnabled}
                                            onEdit={onEdit}
                                            onDelete={onDelete}
                                            onRestore={onRestore}
                                            onSetWidth={onSetWidth}
                                        />
                                        {isContainer && (
                                            <GroupDropArea
                                                containerId={placement.id}
                                                zoneId={zoneId}
                                                childPlacements={kids}
                                                types={types}
                                                busyId={busyId}
                                                showWidth={groupIsRow}
                                                onToggleEnabled={onToggleEnabled}
                                                onEdit={onEdit}
                                                onDelete={onDelete}
                                                onRestore={onRestore}
                                                onSetWidth={onSetWidth}
                                                onMoveWithinList={onMoveWithinList}
                                                onMoveOutOfGroup={onMoveOutOfGroup}
                                            />
                                        )}
                                    </Fragment>
                                );
                            })}
                            {/* Trailing rail: drop here to append at the zone's end. */}
                            <GapRail zoneId={zoneId} beforeId={null} />
                        </>
                    )}
                </div>
            </SortableContext>
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* Placement bubble                                                    */
/* ------------------------------------------------------------------ */

interface PlacementBubbleProps {
    placement: IPlacement;
    typeInfo: { label: string; pluginId: string } | null;
    busy: boolean;
    onToggleEnabled: (placement: IPlacement, next: boolean) => void;
    onEdit: (placement: IPlacement) => void;
    onDelete: (placement: IPlacement) => void;
    onRestore: (placement: IPlacement) => void;
    /**
     * Set this row's relative width (a flex weight) or clear it to auto
     * with `null`. Drives the inline width dropdown so an operator tunes
     * side-by-side widths without opening the modal.
     */
    onSetWidth: (placement: IPlacement, weight: number | null) => void;
    /**
     * Whether the row's container (the zone for a top-level row, the parent
     * layout group for a nested child) lays out in a row. Relative width is a
     * flex weight that only takes effect along a row axis, so the inline width
     * control is hidden in a column arrangement where it would be inert noise.
     */
    showWidth: boolean;
    /** Whether this row is first in its list, disabling the "move up" button. */
    isFirst: boolean;
    /** Whether this row is last in its list, disabling the "move down" button. */
    isLast: boolean;
    /** Reorder this row up one step within its current list. */
    onMoveUp: () => void;
    /** Reorder this row down one step within its current list. */
    onMoveDown: () => void;
    /**
     * Promote this row out of its layout group to the zone top level. Provided
     * only for nested child rows; top-level rows omit it and render no
     * move-out control.
     */
    onMoveOut?: () => void;
}

/**
 * Inline relative-width dropdown for a placement row.
 *
 * Surfaces per-child width tuning on the row itself — the layout-group's
 * own editing surface — so an operator builds a "two-thirds / one-third"
 * row by setting each child's width here rather than hand-editing JSON.
 * Selecting "Auto" clears the weight (`null`); a number sets the flex
 * weight. Extracted so the top-level and nested rows share one control.
 *
 * @param placement - The row whose width this edits.
 * @param disabled - Whether the control is inert (a write is in flight).
 * @param label - Human-readable widget name for the control's accessible
 *   name, so a screen reader announces "Relative width for Layout group"
 *   rather than the raw typeId (`core:layout-group`).
 * @param onSetWidth - Persists the new weight (or `null` to clear).
 */
function WidthSelect({
    placement,
    disabled,
    label,
    onSetWidth
}: {
    placement: IPlacement;
    disabled: boolean;
    label: string;
    onSetWidth: (placement: IPlacement, weight: number | null) => void;
}) {
    const value = placement.layoutWeight !== undefined ? String(placement.layoutWeight) : '';
    return (
        <Select
            className={styles.width_select}
            value={value}
            disabled={disabled}
            aria-label={`Relative width for ${label}`}
            title="Relative width when this row sits in a side-by-side layout"
            onChange={(e) => {
                const raw = e.target.value;
                onSetWidth(placement, raw === '' ? null : Number(raw));
            }}
        >
            {WIDTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
    );
}

/**
 * Single draggable placement card. The grip on the left is the drag
 * activator; the rest of the card stays clickable for the inline
 * switch and action buttons. Order and last-updated are intentionally
 * hidden — both remain editable from the modal opened via the pencil
 * icon.
 */
function PlacementBubble({
    placement,
    typeInfo,
    busy,
    showWidth,
    isFirst,
    isLast,
    onMoveUp,
    onMoveDown,
    onToggleEnabled,
    onEdit,
    onDelete,
    onRestore,
    onSetWidth
}: PlacementBubbleProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: placement.id,
        data: { zoneId: placement.zoneId }
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    };

    const label = placement.title ?? typeInfo?.label ?? placement.typeId;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(styles.bubble, isDragging && styles['bubble--dragging'])}
        >
            <button
                type="button"
                className={styles.bubble_handle}
                aria-label={`Drag ${label} to reorder`}
                {...attributes}
                {...listeners}
            >
                <GripVertical size={16} aria-hidden />
            </button>
            <div className={styles.bubble_main}>
                <div className={styles.bubble_top}>
                    <span className={styles.widget_label}>{label}</span>
                    <Badge tone={sourceTone(placement.source)}>
                        {placement.source === 'plugin'
                            ? `plugin: ${placement.pluginId ?? '?'}`
                            : 'operator'}
                    </Badge>
                </div>
                <span className={styles.widget_meta}>
                    {placement.typeId}
                    {typeInfo && ` · ${typeInfo.pluginId}`}
                </span>
                <div className={styles.bubble_routes}>
                    {placement.routes.length === 0
                        ? <em className={styles.bubble_routes_empty}>every route</em>
                        : placement.routes.map(r => (
                            <code key={r} className={styles.route_chip}>{r}</code>
                        ))}
                </div>
            </div>
            <div className={styles.bubble_actions}>
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${label} up`}
                    onClick={onMoveUp}
                    disabled={busy || isFirst}
                >
                    <ArrowUp size={14} />
                </IconButton>
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${label} down`}
                    onClick={onMoveDown}
                    disabled={busy || isLast}
                >
                    <ArrowDown size={14} />
                </IconButton>
                {showWidth && (
                    <WidthSelect placement={placement} disabled={busy} label={label} onSetWidth={onSetWidth} />
                )}
                <Switch
                    size="sm"
                    on={placement.enabled}
                    onChange={(next) => onToggleEnabled(placement, next)}
                    disabled={busy}
                    aria-label={`${placement.enabled ? 'Disable' : 'Enable'} placement ${label}`}
                />
                <IconButton
                    size="sm"
                    variant="primary"
                    aria-label={`Edit ${label}`}
                    onClick={() => onEdit(placement)}
                >
                    <Pencil size={14} />
                </IconButton>
                {placement.source === 'plugin' ? (
                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Restore plugin defaults for ${label}`}
                        onClick={() => onRestore(placement)}
                        disabled={busy}
                    >
                        <RefreshCw size={14} />
                    </IconButton>
                ) : (
                    <IconButton
                        size="sm"
                        variant="danger"
                        aria-label={`Delete ${label}`}
                        onClick={() => onDelete(placement)}
                    >
                        <Trash2 size={14} />
                    </IconButton>
                )}
            </div>
        </div>
    );
}

/**
 * Sortable row for a widget nested inside a layout-group container.
 *
 * Mirrors `PlacementBubble`'s actions (enable switch, edit, delete /
 * restore) and is draggable via its own grip: dragging a child reorders
 * it within its group, moves it to another group, or — dropped on the
 * zone background — detaches it back to the zone. Its `useSortable` data
 * carries `parentId` so `handleDragEnd` knows which container it came
 * from. The id lives in the container's own `SortableContext`, so it
 * reorders independently of the zone's top-level list.
 *
 * @param placement - The nested child placement to render.
 * @param typeInfo - Resolved widget-type label/owner for display.
 * @param busy - Whether a mutation for this row is in flight.
 * @param onToggleEnabled - Enable/disable handler.
 * @param onEdit - Opens the edit modal.
 * @param onDelete - Deletes an operator-source child.
 * @param onRestore - Restores a plugin-source child's defaults.
 * @param showWidth - Whether the parent group lays out in a row, gating the
 *   inline relative-width control (a flex weight is inert in a column).
 * @param isFirst - Whether this child is first in its group (disables move up).
 * @param isLast - Whether this child is last in its group (disables move down).
 * @param onMoveUp - Reorder this child up one step within its group.
 * @param onMoveDown - Reorder this child down one step within its group.
 * @param onMoveOut - Promote this child out of the group to the zone top level.
 */
function ChildPlacementRow({
    placement,
    typeInfo,
    busy,
    showWidth,
    isFirst,
    isLast,
    onMoveUp,
    onMoveDown,
    onMoveOut,
    onToggleEnabled,
    onEdit,
    onDelete,
    onRestore,
    onSetWidth
}: PlacementBubbleProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: placement.id,
        data: { zoneId: placement.zoneId, parentId: placement.parentId }
    });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const label = placement.title ?? typeInfo?.label ?? placement.typeId;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(styles.bubble, isDragging && styles['bubble--dragging'])}
        >
            <button
                type="button"
                className={styles.bubble_handle}
                aria-label={`Drag ${label} (reorder or move out of the group)`}
                {...attributes}
                {...listeners}
            >
                <GripVertical size={16} aria-hidden />
            </button>
            <div className={styles.bubble_main}>
                <div className={styles.bubble_top}>
                    <span className={styles.widget_label}>{label}</span>
                    <Badge tone={sourceTone(placement.source)}>
                        {placement.source === 'plugin'
                            ? `plugin: ${placement.pluginId ?? '?'}`
                            : 'operator'}
                    </Badge>
                </div>
                <span className={styles.widget_meta}>{placement.typeId}</span>
            </div>
            <div className={styles.bubble_actions}>
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${label} up within the group`}
                    onClick={onMoveUp}
                    disabled={busy || isFirst}
                >
                    <ArrowUp size={14} />
                </IconButton>
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${label} down within the group`}
                    onClick={onMoveDown}
                    disabled={busy || isLast}
                >
                    <ArrowDown size={14} />
                </IconButton>
                {onMoveOut && (
                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${label} out of the group`}
                        onClick={onMoveOut}
                        disabled={busy}
                    >
                        <Ungroup size={14} />
                    </IconButton>
                )}
                {showWidth && (
                    <WidthSelect placement={placement} disabled={busy} label={label} onSetWidth={onSetWidth} />
                )}
                <Switch
                    size="sm"
                    on={placement.enabled}
                    onChange={(next) => onToggleEnabled(placement, next)}
                    disabled={busy}
                    aria-label={`${placement.enabled ? 'Disable' : 'Enable'} placement ${label}`}
                />
                <IconButton
                    size="sm"
                    variant="primary"
                    aria-label={`Edit ${label}`}
                    onClick={() => onEdit(placement)}
                >
                    <Pencil size={14} />
                </IconButton>
                {placement.source === 'plugin' ? (
                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Restore plugin defaults for ${label}`}
                        onClick={() => onRestore(placement)}
                        disabled={busy}
                    >
                        <RefreshCw size={14} />
                    </IconButton>
                ) : (
                    <IconButton
                        size="sm"
                        variant="danger"
                        aria-label={`Delete ${label}`}
                        onClick={() => onDelete(placement)}
                    >
                        <Trash2 size={14} />
                    </IconButton>
                )}
            </div>
        </div>
    );
}

interface GroupDropAreaProps {
    containerId: string;
    zoneId: string;
    childPlacements: IPlacement[];
    types: IWidgetTypeSnapshot | null;
    busyId: string | null;
    onToggleEnabled: (placement: IPlacement, next: boolean) => void;
    onEdit: (placement: IPlacement) => void;
    onDelete: (placement: IPlacement) => void;
    onRestore: (placement: IPlacement) => void;
    onSetWidth: (placement: IPlacement, weight: number | null) => void;
    /**
     * Whether the layout group lays out its children in a row, forwarded to
     * each child so the inline width control only shows where a flex weight
     * actually applies.
     */
    showWidth: boolean;
    /** Reorder a child one step within this group. */
    onMoveWithinList: (placement: IPlacement, direction: 'up' | 'down') => void;
    /** Promote a child out of this group to the zone top level. */
    onMoveOutOfGroup: (placement: IPlacement) => void;
}

/**
 * Droppable, sortable region holding a layout-group container's children.
 *
 * The wrapper is a dnd-kit droppable keyed `group:<containerId>` (so a
 * drop anywhere in the region — including an empty group — lands a widget
 * in this container), and it hosts its own `SortableContext` over the
 * child ids so children reorder independently of the zone's top-level
 * list. `handleDragEnd` reads the droppable's `containerId` to attach the
 * dragged widget. The region always renders for a container, even when
 * empty, so there is a target to drop the first child into.
 *
 * @param containerId - The layout-group placement id this region nests under.
 * @param zoneId - Zone the container lives in, forwarded as drop data.
 * @param childPlacements - The container's children, pre-sorted by order.
 * @param types - Type snapshot for resolving child labels.
 * @param busyId - Placement id with an in-flight mutation, if any.
 * @param onToggleEnabled - Enable/disable handler passed to each child.
 * @param onEdit - Edit-modal opener passed to each child.
 * @param onDelete - Delete handler passed to each child.
 * @param onRestore - Restore-defaults handler passed to each child.
 * @param showWidth - Whether this group is row-arranged, gating each child's
 *   inline relative-width control.
 * @param onMoveWithinList - Reorders a child one step within this group.
 * @param onMoveOutOfGroup - Promotes a child out of this group to the zone.
 */
function GroupDropArea({
    containerId,
    zoneId,
    childPlacements,
    types,
    busyId,
    showWidth,
    onToggleEnabled,
    onEdit,
    onDelete,
    onRestore,
    onSetWidth,
    onMoveWithinList,
    onMoveOutOfGroup
}: GroupDropAreaProps) {
    const { setNodeRef, isOver } = useDroppable({
        id: `group:${containerId}`,
        data: { containerId, zoneId }
    });
    const childIds = useMemo(() => childPlacements.map(c => c.id), [childPlacements]);

    return (
        <div
            ref={setNodeRef}
            className={cn(styles.bubble_children, isOver && styles['bubble_children--drop-target'])}
        >
            <SortableContext id={`group:${containerId}`} items={childIds} strategy={verticalListSortingStrategy}>
                {childPlacements.length === 0 ? (
                    <span className={styles.bubble_children_empty}>
                        Empty group — drag a widget here to nest it.
                    </span>
                ) : (
                    childPlacements.map((child, idx) => (
                        <ChildPlacementRow
                            key={child.id}
                            placement={child}
                            typeInfo={lookupType(types, child.typeId)}
                            busy={busyId === child.id}
                            showWidth={showWidth}
                            isFirst={idx === 0}
                            isLast={idx === childPlacements.length - 1}
                            onMoveUp={() => onMoveWithinList(child, 'up')}
                            onMoveDown={() => onMoveWithinList(child, 'down')}
                            onMoveOut={() => onMoveOutOfGroup(child)}
                            onToggleEnabled={onToggleEnabled}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onRestore={onRestore}
                            onSetWidth={onSetWidth}
                        />
                    ))
                )}
            </SortableContext>
        </div>
    );
}

/**
 * Thin top-level drop rail interleaved between zone rows.
 *
 * Exists to give dragging a clear zone-level target adjacent to a layout
 * group: the group's children region greedily owns the space directly under
 * its container, so without a dedicated rail there is nowhere to land a widget
 * "above" or "below" the group at the zone level. The custom collision
 * strategy returns this rail whenever the pointer is inside it, beating the
 * group region. Its drop data is anchored by the id of the row it sits before
 * (`null` for the trailing rail, meaning append) so `handleDragEnd` inserts at
 * the right index even after the dragged row is removed from the list.
 *
 * @param zoneId - Zone this rail inserts into.
 * @param beforeId - Id of the row this rail precedes, or null to append at the
 *   zone's end.
 */
function GapRail({ zoneId, beforeId }: { zoneId: string; beforeId: string | null }) {
    const { setNodeRef, isOver } = useDroppable({
        id: `gap:${zoneId}:${beforeId ?? 'end'}`,
        data: { kind: 'gap', zoneId, beforeId }
    });
    return (
        <div
            ref={setNodeRef}
            className={cn(styles.gap_rail, isOver && styles['gap_rail--active'])}
            aria-hidden
        />
    );
}

/* ------------------------------------------------------------------ */
/* Instance-config schema-driven form                                  */
/* ------------------------------------------------------------------ */

/**
 * A single operator-editable instanceConfig field, derived from one
 * property of a widget type's `configSchema`.
 */
interface ConfigFieldDescriptor {
    /** Property name in the schema (and key in the emitted config). */
    key: string;
    /** The property's own JSON Schema sub-document. */
    schema: JSONSchema7;
    /** True when the schema lists this key under `required`. */
    required: boolean;
    /** Human label — the schema `title` or a humanized key. */
    label: string;
    /** Optional help text from the schema `description`. */
    description?: string;
}

/**
 * Convert a property key into a readable label when the schema gives no
 * explicit `title` — splits camelCase and snake/kebab runs, then
 * sentence-cases the result (`showUndelegated` → "Show undelegated").
 *
 * @param key - Raw schema property name
 * @returns Sentence-cased label
 */
function humanizeKey(key: string): string {
    const spaced = key
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim()
        .toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Resolve a schema property's primary scalar type, ignoring a nullable
 * `['string', 'null']` union by taking the first non-null member.
 *
 * @param schema - Property schema
 * @returns The primary type name, or undefined when untyped
 */
function primaryType(schema: JSONSchema7): string | undefined {
    const type = schema.type;
    return Array.isArray(type) ? type.find(member => member !== 'null') : type;
}

/**
 * Map a property schema to the editor control it renders as. Enums take
 * precedence over the raw string type so a constrained string becomes a
 * select rather than a free-text input; arrays render as a repeatable row
 * editor regardless of their item shape.
 *
 * @param schema - Property schema
 * @returns The control kind to render
 */
function fieldControlType(schema: JSONSchema7): 'boolean' | 'enum' | 'number' | 'text' | 'array' {
    const type = primaryType(schema);
    if (type === 'boolean') {
        return 'boolean';
    }
    if (type === 'array') {
        return 'array';
    }
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return 'enum';
    }
    if (type === 'integer' || type === 'number') {
        return 'number';
    }
    return 'text';
}

/**
 * Whether a string property should be edited in a multiline box rather
 * than a one-line input. A widget's raw HTML block or a paragraph of copy
 * was previously squeezed into a single-line input, which hid everything
 * past the first eighty characters. The schema says which strings are
 * long-form: a `contentMediaType` (declared by `core:raw-html`) or a
 * `maxLength` well beyond a one-line value.
 *
 * @param schema - The string property's schema
 * @returns True when the field renders as a textarea
 */
function isMultilineString(schema: JSONSchema7): boolean {
    const longMaxLength = typeof schema.maxLength === 'number' && schema.maxLength > 200;
    return typeof schema.contentMediaType === 'string' || longMaxLength;
}

/**
 * Whether an enum property renders as a segmented control (every choice
 * visible, one tap to pick) instead of a dropdown. Segments suit a small
 * set of short choices such as `html | text` or `1h | 24h | 7d`; a dropdown
 * still serves a long list or long labels, which would not fit on one
 * row. A segmented control has no "unset" state, so an optional enum with
 * no schema default keeps the dropdown, whose blank option stands for
 * "use the widget's default".
 *
 * @param field - The enum field descriptor
 * @returns True when the field renders as segments
 */
function enumUsesSegments(field: ConfigFieldDescriptor): boolean {
    const members = field.schema.enum ?? [];
    const canBeUnset = !field.required && field.schema.default === undefined;
    const fewShortChoices = members.length >= 2 && members.length <= 4
        && members.every(member => enumOptionLabel(member).length <= 14);
    return !canBeUnset && fewShortChoices;
}

/** One widget type as the admin snapshot describes it. */
type WidgetTypeRecord = IWidgetTypeSnapshot['groups'][number]['types'][number];

/**
 * Locate a widget type's snapshot record by id, so the form can show the
 * type's label and description alongside the id rather than only the id.
 *
 * @param snapshot - Widget-type snapshot from the admin API
 * @param typeId - Selected widget type id
 * @returns The type record, or undefined when the snapshot lacks it
 */
function findWidgetType(snapshot: IWidgetTypeSnapshot | null, typeId: string): WidgetTypeRecord | undefined {
    let found: WidgetTypeRecord | undefined;
    if (snapshot && typeId) {
        for (const group of snapshot.groups) {
            const match = group.types.find(type => type.id === typeId);
            if (match) {
                found = match;
                break;
            }
        }
    }
    return found;
}

/**
 * Resolve an array property's item shape for the array editor: the item
 * sub-schema, whether each item is a scalar or an object, and (for object
 * items) the scalar fields each row exposes. A tuple `items` array or a
 * boolean `items` shorthand yields an empty object schema and scalar kind;
 * {@link isRepresentableArray} rejects those upstream so the editor never
 * renders them, but the fallback keeps this helper total for callers.
 *
 * @param schema - The array property's own schema
 * @returns The item kind, the item sub-schema, and object-item sub-fields
 */
function describeArrayItems(schema: JSONSchema7): {
    kind: 'scalar' | 'object';
    itemSchema: JSONSchema7;
    fields: ConfigFieldDescriptor[];
} {
    const items = schema.items;
    const itemSchema: JSONSchema7 =
        items && typeof items === 'object' && !Array.isArray(items) ? items : {};
    const kind = primaryType(itemSchema) === 'object' ? 'object' : 'scalar';
    const fields = kind === 'object' ? extractConfigFields(itemSchema) : [];
    return { kind, itemSchema, fields };
}

/**
 * Whether an array property can be edited through the structured form. It
 * is representable when its `items` is a single schema (not a tuple or the
 * boolean shorthand) whose item is either a scalar control or an object
 * exposing at least one representable scalar field. Arrays of arrays, or
 * object items with nothing the form can render, stay raw-JSON-only — the
 * reason a required-array type like `core:world-clocks` was previously
 * unconfigurable through the default form.
 *
 * @param schema - The array property's own schema
 * @returns True when the array editor can round-trip the property
 */
function isRepresentableArray(schema: JSONSchema7): boolean {
    const items = schema.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
        return false;
    }
    const { kind, fields } = describeArrayItems(schema);
    return kind === 'object' ? fields.length > 0 : true;
}

/**
 * Flatten a widget type's `configSchema` into the ordered list of
 * editable fields the form renders. Top-level scalar controls — boolean,
 * enum, number, string — are surfaced, plus arrays the row editor can
 * represent (see {@link isRepresentableArray}). Boolean sub-schemas (JSON
 * Schema's `true`/`false` shorthand) carry no metadata, plain `object`
 * properties cannot round-trip, and unrepresentable arrays are skipped and
 * remain editable only through the raw-JSON editor. Property insertion
 * order is preserved.
 *
 * @param schema - The widget type's instanceConfig schema, if any
 * @returns Ordered field descriptors (empty when no schema fields apply)
 */
function extractConfigFields(schema: JSONSchema7 | undefined): ConfigFieldDescriptor[] {
    if (!schema || primaryType(schema) !== 'object' || !schema.properties) {
        return [];
    }
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const fields: ConfigFieldDescriptor[] = [];
    for (const [key, definition] of Object.entries(schema.properties as Record<string, JSONSchema7Definition>)) {
        if (typeof definition === 'boolean') {
            continue;
        }
        const propertyType = primaryType(definition);
        if (propertyType === 'object') {
            continue;
        }
        if (propertyType === 'array' && !isRepresentableArray(definition)) {
            continue;
        }
        fields.push({
            key,
            schema: definition,
            required: required.has(key),
            label: typeof definition.title === 'string' ? definition.title : humanizeKey(key),
            description: typeof definition.description === 'string' ? definition.description : undefined
        });
    }
    return fields;
}

/**
 * Build the form's working values from any existing instanceConfig,
 * falling back to each field's schema `default`. Numbers with no value
 * become an empty string so the numeric input renders blank rather than
 * `NaN`; an enum keeps its saved member whatever its type, so a numeric or
 * boolean member survives a round trip through edit mode; strings and unset
 * enums default to an empty string; booleans to false.
 *
 * @param fields - Field descriptors for the active schema
 * @param existing - Saved instanceConfig (edit mode) or undefined
 * @returns Keyed working values for the controlled form
 */
function coerceInitialConfig(
    fields: ConfigFieldDescriptor[],
    existing: Record<string, unknown> | undefined
): Record<string, unknown> {
    const value: Record<string, unknown> = {};
    for (const field of fields) {
        const provided = existing ? existing[field.key] : undefined;
        const fallback = field.schema.default;
        const control = fieldControlType(field.schema);
        if (control === 'array') {
            // Arrays are held as the raw array; the row editor coerces each
            // item on render and buildArrayConfig validates them on save.
            value[field.key] = Array.isArray(provided)
                ? provided
                : Array.isArray(fallback)
                    ? fallback
                    : [];
        } else if (control === 'boolean') {
            value[field.key] = Boolean(provided ?? fallback ?? false);
        } else if (control === 'number') {
            const candidate = provided ?? fallback;
            value[field.key] = typeof candidate === 'number' ? candidate : '';
        } else if (control === 'enum') {
            // Keep a numeric or boolean enum member in the type it was saved
            // with. The control displays a member by its String() form and
            // maps that back to the typed member on change, so narrowing the
            // seed to a string would blank an existing value in edit mode and
            // drop it on the next save.
            const candidate = provided ?? fallback;
            const isMember = typeof candidate === 'string'
                || typeof candidate === 'number'
                || typeof candidate === 'boolean';
            value[field.key] = isMember ? candidate : '';
        } else {
            const candidate = provided ?? fallback;
            value[field.key] = typeof candidate === 'string' ? candidate : '';
        }
    }
    return value;
}

/**
 * Validate and coerce one scalar working value against its schema, applying
 * the same AJV subset the form enforces inline — required presence,
 * number/integer typing, and min/max range. Shared by the top-level field
 * loop and scalar array items so both report failures identically. Booleans
 * always yield a value; an optional empty yields `{}` (omit); a required
 * empty or a typing/range violation yields `{ error }`.
 *
 * @param schema - The scalar property schema
 * @param raw - The current working value
 * @param label - Human label used in error messages
 * @param required - Whether an empty value is an error rather than an omit
 * @returns A value to emit, an empty object to omit, or an error to surface
 */
function coerceScalarValue(
    schema: JSONSchema7,
    raw: unknown,
    label: string,
    required: boolean
): { value?: unknown; error?: string } {
    const control = fieldControlType(schema);
    if (control === 'boolean') {
        return { value: Boolean(raw) };
    }
    const isEmpty = raw === undefined || raw === null || raw === '';
    if (isEmpty) {
        return required ? { error: `${label} is required.` } : {};
    }
    if (control === 'number') {
        const num = Number(raw);
        if (Number.isNaN(num)) {
            return { error: `${label} must be a number.` };
        }
        if (primaryType(schema) === 'integer' && !Number.isInteger(num)) {
            return { error: `${label} must be a whole number.` };
        }
        if (typeof schema.minimum === 'number' && num < schema.minimum) {
            return { error: `${label} must be at least ${schema.minimum}.` };
        }
        if (typeof schema.maximum === 'number' && num > schema.maximum) {
            return { error: `${label} must be at most ${schema.maximum}.` };
        }
        return { value: num };
    }
    return { value: raw };
}

/**
 * Build and validate one array field's items. Object items recurse through
 * {@link buildStructuredConfig} so each row's required scalar sub-fields are
 * checked; scalar items coerce individually and drop blank optional rows.
 * Enforces the array's own `minItems` (defaulting to 1 for a required array)
 * so an empty required array fails inline rather than at the server's AJV.
 *
 * @param field - The array field descriptor
 * @param raw - The current working value (expected to be an array)
 * @returns The built item array, or an error message to display
 */
function buildArrayConfig(
    field: ConfigFieldDescriptor,
    raw: unknown
): { value?: unknown[]; error?: string } {
    const items = Array.isArray(raw) ? raw : [];
    const { kind, itemSchema, fields: itemFields } = describeArrayItems(field.schema);
    const built: unknown[] = [];
    for (let index = 0; index < items.length; index++) {
        if (kind === 'object') {
            const source = items[index] && typeof items[index] === 'object'
                ? (items[index] as Record<string, unknown>)
                : {};
            const res = buildStructuredConfig(itemFields, source);
            if (res.error) {
                return { error: `${field.label} #${index + 1}: ${res.error}` };
            }
            built.push(res.value ?? {});
        } else {
            const res = coerceScalarValue(itemSchema, items[index], `${field.label} #${index + 1}`, false);
            if (res.error) {
                return { error: res.error };
            }
            if ('value' in res) {
                built.push(res.value);
            }
        }
    }
    const minItems = typeof field.schema.minItems === 'number'
        ? field.schema.minItems
        : field.required ? 1 : 0;
    if (built.length < minItems) {
        return { error: `${field.label} requires at least ${minItems} ${minItems === 1 ? 'entry' : 'entries'}.` };
    }
    return { value: built };
}

/**
 * Serialize the form's working values into the instanceConfig object to
 * persist, applying a subset of the server's AJV constraints — required
 * presence, number/integer typing, min/max range, and array `minItems` — so
 * the common failures surface inline before the request. The server's AJV
 * remains authoritative for everything else (string `minLength`/`pattern`,
 * enum membership, and so on). Booleans are always emitted; optional empty
 * scalars and empty optional arrays are omitted; required empties,
 * typing/range violations, and short required arrays error.
 *
 * @param fields - Field descriptors for the active schema
 * @param value - Current working values
 * @returns The config object, or an error message to display
 */
function buildStructuredConfig(
    fields: ConfigFieldDescriptor[],
    value: Record<string, unknown>
): { value?: Record<string, unknown>; error?: string } {
    const result: Record<string, unknown> = {};
    for (const field of fields) {
        const control = fieldControlType(field.schema);
        const raw = value[field.key];
        if (control === 'array') {
            const built = buildArrayConfig(field, raw);
            if (built.error) {
                return { error: built.error };
            }
            const arr = built.value ?? [];
            // Emit a required array (already guaranteed non-short above) and
            // any non-empty optional array; omit an empty optional array so
            // it falls through to the type's own default.
            if (field.required || arr.length > 0) {
                result[field.key] = arr;
            }
            continue;
        }
        const res = coerceScalarValue(field.schema, raw, field.label, field.required);
        if (res.error) {
            return { error: res.error };
        }
        if ('value' in res) {
            result[field.key] = res.value;
        }
    }
    return { value: result };
}

/**
 * Whether a field takes the full width of the settings grid. Short
 * controls (a dropdown, a segmented control, a number) sit two to a row;
 * anything holding free text, a sentence of help beside a switch, or a
 * list of rows needs the whole width to stay readable.
 *
 * @param field - The field descriptor
 * @returns True when the field spans both grid columns
 */
function fieldSpansRow(field: ConfigFieldDescriptor): boolean {
    const control = fieldControlType(field.schema);
    return control === 'text' || control === 'array' || control === 'boolean';
}

/**
 * Renders one schema-derived instanceConfig field with the control its
 * type implies: a toggle row for booleans, segments or a dropdown for
 * enums, a numeric Input for integer/number (with min/max/step), a
 * textarea for long-form strings, and a text Input otherwise. The label
 * carries the schema title and a required marker; the description
 * becomes help text under the control, or a tooltip and placeholder in
 * compact mode, where a repeated paragraph under every row of a list would
 * bury the controls.
 *
 * @param props.field - The field descriptor
 * @param props.value - The current working value
 * @param props.idPrefix - Prefix keeping this field's element id unique across list rows
 * @param props.disabled - Whether the control is inert (save in flight)
 * @param props.compact - True inside a list row: help moves into a tooltip and placeholder
 * @param props.className - Grid placement class supplied by the parent
 * @param props.onChange - Receives the new working value
 */
function InstanceConfigField({
    field,
    value,
    idPrefix,
    disabled,
    compact = false,
    className,
    onChange
}: {
    field: ConfigFieldDescriptor;
    value: unknown;
    idPrefix: string;
    disabled: boolean;
    compact?: boolean;
    className?: string;
    onChange: (next: unknown) => void;
}) {
    const control = fieldControlType(field.schema);
    if (control === 'array') {
        return (
            <InstanceConfigArrayField
                field={field}
                value={value}
                idPrefix={idPrefix}
                disabled={disabled}
                className={className}
                onChange={onChange}
            />
        );
    }
    const fieldId = `${idPrefix}-${field.key}`;
    const hint = compact ? undefined : field.description;
    const tooltip = compact ? field.description : undefined;
    const marker = field.required ? <span className={styles.config_required} aria-hidden> *</span> : null;

    if (control === 'boolean') {
        return (
            <div className={cn(styles.toggle_row, className)}>
                <Switch
                    id={fieldId}
                    size="sm"
                    on={Boolean(value)}
                    onChange={onChange}
                    disabled={disabled}
                    aria-label={field.label}
                    title={tooltip}
                />
                <label htmlFor={fieldId} className={styles.toggle_row_text}>
                    <span className={styles.field_label}>{field.label}</span>
                    {hint && <span className={styles.field_hint}>{hint}</span>}
                </label>
            </div>
        );
    }

    if (control === 'enum') {
        // Render every enum member, not just string ones: a numeric or
        // boolean enum is displayed by its String() form but mapped back
        // to its original typed value on change, so the persisted config
        // carries the type the server's AJV schema expects.
        const members = field.schema.enum ?? [];
        const current = value !== undefined && value !== null ? String(value) : '';
        /**
         * Map the chosen option's string form back to the typed enum
         * member before lifting it to the parent.
         *
         * @param selected - The option or segment value as a string
         */
        const selectMember = (selected: string) => {
            const match = members.find(member => String(member) === selected);
            onChange(match !== undefined ? match : selected);
        };

        if (enumUsesSegments(field)) {
            // The shared Field cannot label a segmented control (a group has
            // no id a <label> may point at), so the label and hint are laid
            // out by hand with the same field tokens.
            return (
                <div className={cn(styles.field_group, className)}>
                    <span className={styles.field_label}>{field.label}{marker}</span>
                    <SegmentedControl
                        label={field.label}
                        value={current}
                        disabled={disabled}
                        onChange={selectMember}
                        options={members.map(member => {
                            const raw = String(member);
                            const text = enumOptionLabel(member);
                            return { id: raw, label: text, title: text === raw ? undefined : raw };
                        })}
                    />
                    {hint && <span className={styles.field_hint}>{hint}</span>}
                </div>
            );
        }

        return (
            <Field label={field.label} required={field.required} hint={hint} className={className}>
                <Select
                    id={fieldId}
                    size="sm"
                    value={current}
                    onChange={(e) => selectMember(e.target.value)}
                    disabled={disabled}
                    title={tooltip}
                >
                    {!field.required && <option value="">Default</option>}
                    {members.map(member => {
                        const raw = String(member);
                        return <option key={raw} value={raw}>{enumOptionLabel(member)}</option>;
                    })}
                </Select>
            </Field>
        );
    }

    if (control === 'number') {
        const min = typeof field.schema.minimum === 'number' ? field.schema.minimum : undefined;
        const max = typeof field.schema.maximum === 'number' ? field.schema.maximum : undefined;
        const integer = primaryType(field.schema) === 'integer';
        // A schema that declares no granularity is saying every value in its
        // range is allowed, so the input has to say so too. Leaving `step` off
        // does not mean "no constraint": the browser then applies its own
        // default of 1, counted from `min`, which turns a continuous range into
        // a ladder. A field declaring `minimum: 0.5` ends up accepting 0.5 and
        // 1.5 while rejecting 0.9 on submit, and nothing in the schema asked
        // for that. `multipleOf` is how a schema states a real granularity, so
        // honour it when present and otherwise leave the field open.
        const granularity = typeof field.schema.multipleOf === 'number'
            ? field.schema.multipleOf
            : (integer ? 1 : 'any');
        return (
            <Field label={field.label} required={field.required} hint={hint} className={className}>
                <Input
                    id={fieldId}
                    size="sm"
                    type="number"
                    inputMode={integer ? 'numeric' : 'decimal'}
                    min={min}
                    max={max}
                    step={granularity}
                    value={value === undefined || value === null || value === '' ? '' : String(value)}
                    onChange={(e) => {
                        // Keep a clean parse as a number so save/validation
                        // and the raw-JSON view see the right type, but hold
                        // transient unparseable input (`-`, `1e`) as raw text
                        // rather than storing NaN, which would render as the
                        // literal "NaN" and trap the field.
                        const text = e.target.value;
                        if (text === '') {
                            onChange('');
                            return;
                        }
                        const num = Number(text);
                        onChange(Number.isNaN(num) ? text : num);
                    }}
                    disabled={disabled}
                    title={tooltip}
                />
            </Field>
        );
    }

    const text = typeof value === 'string' ? value : '';
    return (
        <Field label={field.label} required={field.required} hint={hint} className={className}>
            {isMultilineString(field.schema) ? (
                <Textarea
                    id={fieldId}
                    size="sm"
                    className={styles.textarea_content}
                    rows={6}
                    value={text}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    spellCheck={false}
                    placeholder={tooltip}
                    title={tooltip}
                />
            ) : (
                <Input
                    id={fieldId}
                    size="sm"
                    value={text}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    placeholder={tooltip}
                    title={tooltip}
                />
            )}
        </Field>
    );
}

/**
 * Derive a singular noun from a field label for per-row labels and the
 * add-row button ("Zones" → "Zone"). A naive trailing-`s` strip — adequate
 * for the operator-facing labels widget schemas use and far cheaper than a
 * pluralization library; falls back to the label unchanged when stripping
 * would leave nothing.
 *
 * @param label - The array field's plural label
 * @returns A best-effort singular form
 */
function singularizeLabel(label: string): string {
    return label.length > 1 && label.endsWith('s') ? label.slice(0, -1) : label;
}

/**
 * Renders an array instanceConfig field as an editable list of rows so a
 * widget type whose schema requires an array (e.g. `core:world-clocks`
 * `zones`) is configurable through the structured form instead of only the
 * raw-JSON escape hatch. Each row is either a group of scalar sub-fields
 * (object items) or a single scalar control (scalar items); both reuse
 * {@link InstanceConfigField} so rendering and validation stay consistent
 * with top-level fields. Operators add and remove rows; the parent holds the
 * array in working state and {@link buildArrayConfig} validates it on save.
 *
 * @param props - The array field descriptor, current value, change handler, and disabled flag
 */
function InstanceConfigArrayField({
    field,
    value,
    idPrefix,
    disabled,
    className,
    onChange
}: {
    field: ConfigFieldDescriptor;
    value: unknown;
    idPrefix: string;
    disabled: boolean;
    className?: string;
    onChange: (next: unknown) => void;
}) {
    const items = Array.isArray(value) ? value : [];
    const { kind, itemSchema, fields: itemFields } = describeArrayItems(field.schema);
    const marker = field.required ? <span className={styles.config_required} aria-hidden> *</span> : null;
    const singular = singularizeLabel(field.label);

    /**
     * Replace one row immutably and lift the new array to the parent.
     *
     * @param index - Row position to replace
     * @param nextItem - The row's new value
     */
    const updateItem = (index: number, nextItem: unknown) => {
        const next = items.slice();
        next[index] = nextItem;
        onChange(next);
    };

    /**
     * Drop one row and lift the shortened array to the parent.
     *
     * @param index - Row position to remove
     */
    const removeItem = (index: number) => {
        onChange(items.filter((_, i) => i !== index));
    };

    /**
     * Append a blank row seeded from the item shape — object items get their
     * scalar defaults, scalar items get the item schema default or an empty
     * string — so a fresh row renders editable controls rather than nothing.
     */
    const addItem = () => {
        const blank = kind === 'object'
            ? coerceInitialConfig(itemFields, undefined)
            : itemSchema.default ?? '';
        onChange([...items, blank]);
    };

    return (
        <div className={cn(styles.field_group, className)}>
            <div className={styles.field_group_header}>
                <span className={styles.field_label}>{field.label}{marker}</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={addItem}
                    disabled={disabled}
                >
                    <Plus size={14} aria-hidden /> Add {singular.toLowerCase()}
                </Button>
            </div>
            {field.description && <span className={styles.field_hint}>{field.description}</span>}
            <div className={styles.config_array}>
                {items.length === 0 && (
                    <span className={styles.config_array_empty}>
                        No {field.label.toLowerCase()} yet.
                    </span>
                )}
                {items.map((item, index) => (
                    <div key={index} className={styles.config_array_item}>
                        <span className={styles.config_array_index} aria-hidden>{index + 1}</span>
                        <div className={styles.config_array_fields}>
                            {kind === 'object'
                                ? itemFields.map(sub => (
                                    <InstanceConfigField
                                        key={sub.key}
                                        field={sub}
                                        value={item && typeof item === 'object'
                                            ? (item as Record<string, unknown>)[sub.key]
                                            : undefined}
                                        idPrefix={`${idPrefix}-${field.key}-${index}`}
                                        disabled={disabled}
                                        compact
                                        onChange={(next) => updateItem(index, {
                                            ...(item && typeof item === 'object' ? item as Record<string, unknown> : {}),
                                            [sub.key]: next
                                        })}
                                    />
                                ))
                                : (
                                    <InstanceConfigField
                                        field={{ key: 'item', schema: itemSchema, required: false, label: `${singular} ${index + 1}` }}
                                        value={item}
                                        idPrefix={`${idPrefix}-${field.key}-${index}`}
                                        disabled={disabled}
                                        compact
                                        onChange={(next) => updateItem(index, next)}
                                    />
                                )}
                        </div>
                        <IconButton
                            size="sm"
                            variant="danger"
                            aria-label={`Remove ${singular} ${index + 1}`}
                            onClick={() => removeItem(index)}
                            disabled={disabled}
                        >
                            <Trash2 size={14} />
                        </IconButton>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Titled group of related fields inside the placement form. Grouping the
 * form into Placement, Visibility, Title, and Settings is what lets an
 * operator find one control in a form that used to be a single scroll of
 * unlabelled rows. A `section` with `aria-labelledby` gives assistive
 * technology the same grouping.
 *
 * @param props.title - Short group name shown as the section heading
 * @param props.action - Optional control rendered at the right of the heading, such as the JSON toggle
 * @param props.children - The group's fields
 */
function FormSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    const headingId = useId();
    return (
        <section className={styles.form_section} aria-labelledby={headingId}>
            <div className={styles.form_section_header}>
                <h3 id={headingId} className={styles.form_section_title}>{title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

/** Valid `collapseBelow` values, taken from the dropdown options so the two cannot drift. */
const COLLAPSE_VALUES = COLLAPSE_OPTIONS.map(option => option.value);

/**
 * Work out which named preset a layout matches, so a layout group whose
 * saved config never recorded a preset still opens on the preset dropdown
 * rather than on "Custom".
 *
 * @param layout - The flex fields to compare against each preset
 * @returns The matching preset name, or `'custom'` when none matches
 */
function detectPreset(layout: IZoneLayoutConfig): ZoneLayoutPreset {
    const names = Object.keys(LAYOUT_PRESETS) as Array<Exclude<ZoneLayoutPreset, 'custom'>>;
    const match = names.find(name => {
        const preset = LAYOUT_PRESETS[name];
        return preset.flexDirection === layout.flexDirection
            && preset.justifyContent === layout.justifyContent
            && preset.alignItems === layout.alignItems
            && preset.flexWrap === layout.flexWrap;
    });
    return match ?? 'custom';
}

/**
 * Read a layout group's working instanceConfig as an `IZoneLayoutConfig`
 * so the shared layout editor can drive it. Each flex field is accepted
 * only when it is one of the known values and otherwise falls back to the
 * schema default, so a half-typed raw-JSON edit cannot put the editor into
 * a state it cannot render.
 *
 * @param value - The form's working config values for the layout group
 * @returns A complete layout config the editor can display
 */
function toLayoutConfig(value: Record<string, unknown>): IZoneLayoutConfig {
    /**
     * Accept a working value only when it is one of the allowed members.
     *
     * @param key - The config key to read
     * @param allowed - The values the schema permits for that key
     * @param fallback - The schema default used when the value is missing or invalid
     */
    const pick = <T extends string>(key: string, allowed: ReadonlyArray<T>, fallback: T): T => {
        const raw = value[key];
        return typeof raw === 'string' && (allowed as ReadonlyArray<string>).includes(raw) ? raw as T : fallback;
    };
    const layout: IZoneLayoutConfig = {
        flexDirection: pick('flexDirection', DIRECTION_OPTIONS, 'column'),
        justifyContent: pick('justifyContent', JUSTIFY_OPTIONS, 'flex-start'),
        alignItems: pick('alignItems', ALIGN_OPTIONS, 'stretch'),
        flexWrap: pick('flexWrap', WRAP_OPTIONS, 'nowrap'),
        gap: pick('gap', GAP_OPTIONS, 'md'),
        collapseBelow: pick('collapseBelow', COLLAPSE_VALUES, 'never')
    };
    const presetNames = PRESET_OPTIONS.map(option => option.value);
    layout.preset = pick('preset', presetNames, detectPreset(layout));
    return layout;
}

/* ------------------------------------------------------------------ */
/* Placement form (create + edit)                                      */
/* ------------------------------------------------------------------ */

interface PlacementFormProps {
    mode: 'create' | 'edit';
    initial?: IPlacement;
    /**
     * Routes to pre-fill in create mode — the URL the operator has the
     * editor scoped to, so a widget placed from that view targets the
     * page they were looking at. Ignored in edit mode (the placement's
     * own routes win).
     */
    defaultRoutes?: string[];
    types: IWidgetTypeSnapshot | null;
    zones: IZoneSnapshot | null;
    /**
     * Every loaded placement, so the form can offer the layout-group
     * containers in the selected zone as parent options.
     */
    placements: IPlacement[];
    onSubmit: (data: IPlacementCreate | IPlacementPatch) => Promise<void>;
    onCancel: () => void;
}

function PlacementForm({ mode, initial, defaultRoutes, types, zones, placements, onSubmit, onCancel }: PlacementFormProps) {
    const [typeId, setTypeId] = useState<string>(initial?.typeId ?? '');
    const [zoneId, setZoneId] = useState<string>(initial?.zoneId ?? '');
    const [parentId, setParentId] = useState<string>(initial?.parentId ?? '');
    const [routes, setRoutes] = useState<string[]>(initial?.routes ?? defaultRoutes ?? []);
    const [routeDraft, setRouteDraft] = useState<string>('');
    const [order, setOrder] = useState<number>(initial?.order ?? 100);
    const [title, setTitle] = useState<string>(initial?.title ?? '');
    const [titleUrl, setTitleUrl] = useState<string>(initial?.titleUrl ?? '');
    // Chrome-title heading size. Absent on the row means the default, so the
    // select seeds to 'heading-md' and the submit logic omits/clears the
    // default rather than persisting it.
    const [titleSize, setTitleSize] = useState<WidgetTitleSize>(initial?.titleSize ?? 'heading-md');
    const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);
    const [saving, setSaving] = useState<boolean>(false);
    const [routeError, setRouteError] = useState<string | null>(null);

    // Per-placement instanceConfig surface, driven by the selected
    // widget type's declared JSON Schema (carried in the type snapshot).
    // Operators edit typed fields by default; an "Edit as JSON" escape
    // hatch exposes the raw object for keys the form cannot represent.
    // Types with no schema fall straight through to the raw editor.
    const selectedType = useMemo(() => findWidgetType(types, typeId), [types, typeId]);
    const selectedSchema = selectedType?.configSchema;
    const configFields = useMemo(() => extractConfigFields(selectedSchema), [selectedSchema]);
    const hasSchemaFields = configFields.length > 0;
    // Element-id prefix for every control in this form. Generated rather
    // than fixed so a list row's sub-fields, which repeat per row, never
    // collide with each other or with a second form on the page.
    const formId = useId();

    // A layout group cannot itself be nested; the Container picker is
    // hidden for it. For every other type, offer the layout-group
    // containers that live in the selected zone as parent options. The
    // row being edited is excluded so it can never parent itself.
    const isLayoutGroup = typeId === LAYOUT_GROUP_TYPE_ID;
    const containers = useMemo(
        () => placements.filter(p =>
            p.typeId === LAYOUT_GROUP_TYPE_ID &&
            !p.parentId &&
            p.id !== initial?.id &&
            p.zoneId === zoneId
        ),
        [placements, initial?.id, zoneId]
    );

    // Drop a stale parent selection when the operator switches to a zone
    // (or a type) where the chosen container is no longer valid.
    useEffect(() => {
        if (parentId && !containers.some(c => c.id === parentId)) {
            setParentId('');
        }
    }, [containers, parentId]);

    // A nested widget shows wherever its container shows: the backend
    // clears a child's own routes on attach. The routes editor is hidden
    // while a container is selected so the operator is not asked for a
    // filter that would be discarded.
    const nested = !isLayoutGroup && parentId.length > 0;

    const [configValue, setConfigValue] = useState<Record<string, unknown>>(
        () => coerceInitialConfig(configFields, initial?.instanceConfig as Record<string, unknown> | undefined)
    );

    // A layout group's settings are an IZoneLayoutConfig, so the modal
    // reuses the preset-driven editor the zone panel uses instead of
    // seven generic dropdowns. The editor reads a normalised view of the
    // working values and writes back only the keys the schema declares.
    const layoutGroupConfig = useMemo(
        () => (isLayoutGroup ? toLayoutConfig(configValue) : null),
        [isLayoutGroup, configValue]
    );

    /**
     * Copy an edited layout config back into the working config values,
     * key by key, so the raw-JSON view and the save path see the same
     * object shape the schema validates.
     *
     * @param config - The layout the shared editor produced
     */
    const applyLayoutGroupConfig = useCallback((config: IZoneLayoutConfig) => {
        const source = config as unknown as Record<string, unknown>;
        setConfigValue(prev => {
            const next = { ...prev };
            for (const field of configFields) {
                if (field.key in source) {
                    next[field.key] = source[field.key];
                }
            }
            return next;
        });
    }, [configFields]);
    const [rawMode, setRawMode] = useState<boolean>(() => !hasSchemaFields);
    const [rawText, setRawText] = useState<string>(
        () => (initial?.instanceConfig ? JSON.stringify(initial.instanceConfig, null, 2) : '')
    );
    const [instanceConfigError, setInstanceConfigError] = useState<string | null>(null);

    // Create mode lets the operator switch widget types, which swaps the
    // active schema — reset the config surface to the new schema's
    // defaults and prefer its form. Edit mode pins the type, so the
    // mount-time initial values stand and this never fires.
    useEffect(() => {
        if (mode !== 'create') {
            return;
        }
        setConfigValue(coerceInitialConfig(configFields, undefined));
        setRawMode(configFields.length === 0);
        setRawText('');
        setInstanceConfigError(null);
    }, [mode, configFields]);

    /**
     * Switch the config editor into raw-JSON mode, seeding the textarea
     * with the current structured values (best-effort; ignores validation
     * so the operator can hand-fix whatever is set).
     */
    const enterRawMode = useCallback(() => {
        // Best-effort serialize the working values straight to JSON,
        // bypassing buildStructuredConfig's validation: a half-filled or
        // out-of-range form must survive the switch so the operator can
        // hand-fix it, rather than collapsing to `{}` on the error path.
        const draft: Record<string, unknown> = {};
        for (const field of configFields) {
            const raw = configValue[field.key];
            if (fieldControlType(field.schema) === 'boolean') {
                draft[field.key] = Boolean(raw);
            } else if (raw !== undefined && raw !== null && raw !== '') {
                draft[field.key] = raw;
            }
        }
        setRawText(JSON.stringify(draft, null, 2));
        setInstanceConfigError(null);
        setRawMode(true);
    }, [configFields, configValue]);

    /**
     * Switch back to the structured form, parsing the raw JSON into the
     * working values. Rejects malformed JSON and non-object payloads,
     * keeping the operator in raw mode with an inline error.
     */
    const exitRawMode = useCallback(() => {
        const trimmed = rawText.trim();
        if (trimmed.length > 0) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(trimmed);
            } catch (err) {
                setInstanceConfigError(err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON');
                return;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setInstanceConfigError('Instance config must be a JSON object');
                return;
            }
            setConfigValue(coerceInitialConfig(configFields, parsed as Record<string, unknown>));
        } else {
            setConfigValue(coerceInitialConfig(configFields, undefined));
        }
        setInstanceConfigError(null);
        setRawMode(false);
    }, [configFields, rawText]);

    const handleAddRoute = useCallback(() => {
        const trimmed = routeDraft.trim();
        if (trimmed.length === 0) return;
        if (!trimmed.startsWith('/')) {
            setRouteError('Patterns must start with /');
            return;
        }
        if (/\s/.test(trimmed)) {
            setRouteError('Patterns cannot contain whitespace');
            return;
        }
        if (routes.includes(trimmed)) {
            setRouteError('Pattern already added');
            return;
        }
        setRoutes(prev => [...prev, trimmed]);
        setRouteDraft('');
        setRouteError(null);
    }, [routeDraft, routes]);

    const handleRouteKey = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                handleAddRoute();
            }
        },
        [handleAddRoute]
    );

    const handleRemoveRoute = useCallback((entry: string) => {
        setRoutes(prev => prev.filter(r => r !== entry));
    }, []);

    const handleSubmit = useCallback(
        async (e: FormEvent) => {
            e.preventDefault();

            // Resolve instanceConfig from whichever editor is active.
            //
            // Raw mode: any non-empty input must parse to a plain JSON
            // object — array and primitive parses are rejected
            // client-side rather than relying on the server's shape-only
            // guard so the operator sees the failure inline.
            //
            // Form mode: build the object from the typed fields, applying
            // the schema's required/range constraints inline.
            //
            // An empty result has different semantics by mode:
            //   - create → omit (no overrides; defaults apply)
            //   - edit   → send `{}` to explicitly clear overrides on the
            //              existing row. Omitting the field on patch would
            //              leave the prior value intact.
            let parsedInstanceConfig: Record<string, unknown> | undefined;
            if (rawMode) {
                const rawConfig = rawText.trim();
                if (rawConfig.length > 0) {
                    try {
                        const candidate = JSON.parse(rawConfig);
                        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
                            setInstanceConfigError('Instance config must be a JSON object');
                            return;
                        }
                        parsedInstanceConfig = candidate as Record<string, unknown>;
                    } catch (err) {
                        setInstanceConfigError(
                            err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON'
                        );
                        return;
                    }
                } else if (mode === 'edit') {
                    parsedInstanceConfig = {};
                }
            } else {
                const built = buildStructuredConfig(configFields, configValue);
                if (built.error) {
                    setInstanceConfigError(built.error);
                    return;
                }
                const obj = built.value ?? {};
                if (Object.keys(obj).length === 0) {
                    parsedInstanceConfig = mode === 'edit' ? {} : undefined;
                } else {
                    parsedInstanceConfig = obj;
                }
            }
            setInstanceConfigError(null);

            setSaving(true);
            try {
                if (mode === 'create') {
                    // Only nest non-group widgets; a layout group is always
                    // top-level. The backend forces the child's zone and
                    // clears its routes when a parent is supplied.
                    const effectiveParent = !isLayoutGroup && parentId.length > 0 ? parentId : undefined;
                    const payload: IPlacementCreate = {
                        typeId,
                        zoneId,
                        parentId: effectiveParent,
                        routes,
                        order,
                        title: title.trim().length > 0 ? title.trim() : undefined,
                        titleUrl: titleUrl.trim().length > 0 ? titleUrl.trim() : undefined,
                        // Persist only a non-default size; heading-md is the render
                        // fallback, so storing it would just be noise.
                        titleSize: titleSize !== 'heading-md' ? titleSize : undefined,
                        instanceConfig: parsedInstanceConfig,
                        enabled
                    };
                    await onSubmit(payload);
                } else {
                    const trimmedTitle = title.trim();
                    const hadInitialTitle = typeof initial?.title === 'string' && initial.title.length > 0;
                    // Edit-mode title semantics:
                    //   - non-empty input → set the new value
                    //   - blank input when the row HAD a title → null
                    //     (explicit clear signal honored as $unset)
                    //   - blank input when the row had no title →
                    //     omit so the patch is a no-op for that field
                    const titlePatch: string | null | undefined =
                        trimmedTitle.length > 0
                            ? trimmedTitle
                            : hadInitialTitle
                                ? null
                                : undefined;
                    // titleUrl follows the same three-state convention
                    // as title: set when non-empty, explicit null clear
                    // when blanked after having a value, omit otherwise.
                    const trimmedTitleUrl = titleUrl.trim();
                    const hadInitialTitleUrl = typeof initial?.titleUrl === 'string' && initial.titleUrl.length > 0;
                    const titleUrlPatch: string | null | undefined =
                        trimmedTitleUrl.length > 0
                            ? trimmedTitleUrl
                            : hadInitialTitleUrl
                                ? null
                                : undefined;
                    // Container reassignment, three-state like title:
                    //   - a selected container → attach (string)
                    //   - cleared after having had one → null (detach)
                    //   - never had one and none selected → omit
                    // A layout group is never nested, so it always omits.
                    const hadInitialParent = typeof initial?.parentId === 'string';
                    const parentIdPatch: string | null | undefined = isLayoutGroup
                        ? undefined
                        : parentId.length > 0
                            ? parentId
                            : hadInitialParent
                                ? null
                                : undefined;
                    // titleSize three-state against the effective initial value
                    // (a bare row reads as heading-md): unchanged → omit;
                    // changed to the default → null ($unset back to heading-md);
                    // changed to a non-default → set.
                    const initialTitleSize: WidgetTitleSize = initial?.titleSize ?? 'heading-md';
                    const titleSizePatch: WidgetTitleSize | null | undefined =
                        titleSize === initialTitleSize
                            ? undefined
                            : titleSize === 'heading-md'
                                ? null
                                : titleSize;
                    const payload: IPlacementPatch = {
                        zoneId,
                        parentId: parentIdPatch,
                        routes,
                        order,
                        title: titlePatch,
                        titleUrl: titleUrlPatch,
                        titleSize: titleSizePatch,
                        instanceConfig: parsedInstanceConfig,
                        enabled
                    };
                    await onSubmit(payload);
                }
            } finally {
                setSaving(false);
            }
        },
        [configFields, configValue, enabled, initial?.title, initial?.titleUrl, initial?.titleSize, initial?.parentId, isLayoutGroup, mode, onSubmit, order, parentId, rawMode, rawText, routes, title, titleUrl, titleSize, typeId, zoneId]
    );

    const canSubmit = typeId.length > 0 && zoneId.length > 0;
    const routesId = `${formId}-routes`;
    const typeHint = selectedType?.description;

    /**
     * Pick the settings editor for the current mode and type. Raw JSON
     * wins when the operator asked for it or the type declares no fields;
     * a layout group gets the preset editor; every other type gets its
     * schema fields laid out two to a row.
     *
     * @returns The settings body, or a placeholder before a type is chosen
     */
    const renderSettings = (): ReactNode => {
        let body: ReactNode;
        if (typeId.length === 0) {
            body = <p className={styles.config_placeholder}>Choose a widget type to see its settings.</p>;
        } else if (rawMode) {
            body = (
                <Field
                    hint={hasSchemaFields
                        ? 'Validated against the widget’s settings schema on save.'
                        : 'This widget declares no settings. Optional JSON here is passed to it as overrides.'}
                    error={instanceConfigError ?? undefined}
                >
                    <Textarea
                        id={`${formId}-config-json`}
                        size="sm"
                        className={styles.textarea}
                        rows={8}
                        value={rawText}
                        onChange={(e) => { setRawText(e.target.value); setInstanceConfigError(null); }}
                        placeholder="{}"
                        disabled={saving}
                        spellCheck={false}
                        invalid={instanceConfigError !== null}
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
                <div className={styles.form_grid}>
                    {configFields.map(field => (
                        <InstanceConfigField
                            key={field.key}
                            field={field}
                            value={configValue[field.key]}
                            idPrefix={`${formId}-config`}
                            disabled={saving}
                            className={fieldSpansRow(field) ? styles.form_span : undefined}
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
            <FormSection title="Placement">
                <div className={styles.form_grid}>
                    {mode === 'create' ? (
                        <Field
                            label="Widget type"
                            required
                            hint={typeHint}
                            className={styles.form_span}
                        >
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
                                    <optgroup key={group.pluginId} label={group.pluginId}>
                                        {group.types.map(t => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </Select>
                        </Field>
                    ) : (
                        // The type of an existing placement cannot change, so a
                        // disabled dropdown would only invite a click that does
                        // nothing. A read-only summary says what the widget is.
                        <div className={cn(styles.form_static, styles.form_span)}>
                            <span className={styles.field_label}>Widget type</span>
                            <span className={styles.form_static_value}>
                                <span>{selectedType?.label ?? typeId}</span>
                                <code className={styles.widget_meta}>{typeId}</code>
                            </span>
                            {typeHint && <span className={styles.field_hint}>{typeHint}</span>}
                        </div>
                    )}

                    <Field label="Zone" required>
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
                                    {track.zones.map(z => (
                                        <option key={z.id} value={z.id}>{z.label}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </Select>
                    </Field>

                    <Field label="Order" hint="Lower numbers render first.">
                        <Input
                            id={`${formId}-order`}
                            size="sm"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={10000}
                            value={order}
                            onChange={(e) => setOrder(parseInt(e.target.value, 10) || 0)}
                            disabled={saving}
                        />
                    </Field>

                    {!isLayoutGroup && containers.length > 0 && (
                        <Field
                            label="Container"
                            hint={nested
                                ? 'Nested widgets follow the group’s route filter and arrangement.'
                                : 'Optionally nest this widget inside a layout group in this zone.'}
                            className={styles.form_span}
                        >
                            <Select
                                id={`${formId}-parent`}
                                size="sm"
                                value={parentId}
                                onChange={(e) => setParentId(e.target.value)}
                                disabled={saving}
                            >
                                <option value="">None, place directly in the zone</option>
                                {containers.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.title ?? 'Layout group'} (…{c.id.slice(-6)})
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    )}
                </div>
            </FormSection>

            <FormSection title="Visibility">
                <div className={styles.toggle_row}>
                    <Switch
                        id={`${formId}-enabled`}
                        size="sm"
                        on={enabled}
                        onChange={setEnabled}
                        disabled={saving}
                        aria-label="Enabled"
                    />
                    <label htmlFor={`${formId}-enabled`} className={styles.toggle_row_text}>
                        <span className={styles.field_label}>Enabled</span>
                        <span className={styles.field_hint}>A disabled placement keeps its settings but does not render.</span>
                    </label>
                </div>

                {!nested && (
                    <Field
                        label="Routes"
                        htmlFor={routesId}
                        error={routeError ?? undefined}
                        hint={(
                            <>
                                Leave empty to show on every page. <code>/tools/*</code> matches one path segment,
                                {' '}<code>/system/**</code> matches any depth. Press Enter or comma to add.
                            </>
                        )}
                    >
                        {routes.length > 0 && (
                            <div className={styles.routes_chips}>
                                {routes.map(entry => (
                                    <span key={entry} className={styles.route_chip_editable}>
                                        <code>{entry}</code>
                                        <button
                                            type="button"
                                            aria-label={`Remove ${entry}`}
                                            onClick={() => handleRemoveRoute(entry)}
                                            disabled={saving}
                                            className={styles.route_chip_remove}
                                        >
                                            <X size={12} aria-hidden />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className={styles.routes_input_row}>
                            <Input
                                id={routesId}
                                size="sm"
                                value={routeDraft}
                                onChange={(e) => { setRouteDraft(e.target.value); setRouteError(null); }}
                                onKeyDown={handleRouteKey}
                                placeholder="/about or /tools/* or /system/**"
                                disabled={saving}
                                invalid={routeError !== null}
                                // Field cannot inject this onto one of several
                                // children; the ids follow Field's own
                                // `<controlId>-hint` / `<controlId>-error` naming.
                                aria-describedby={routeError ? `${routesId}-error` : `${routesId}-hint`}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleAddRoute}
                                disabled={saving || routeDraft.trim().length === 0}
                            >
                                Add
                            </Button>
                        </div>
                    </Field>
                )}
            </FormSection>

            <FormSection title="Title">
                <div className={styles.form_grid}>
                    <Field label="Title">
                        <Input
                            id={`${formId}-title`}
                            size="sm"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Widget default"
                            maxLength={80}
                            disabled={saving}
                        />
                    </Field>
                    <Field label="Title size">
                        <Select
                            id={`${formId}-title-size`}
                            size="sm"
                            value={titleSize}
                            onChange={(e) => setTitleSize(e.target.value as WidgetTitleSize)}
                            disabled={saving}
                        >
                            <option value="heading-xs">Extra small</option>
                            <option value="heading-sm">Small</option>
                            <option value="heading-md">Medium (default)</option>
                            <option value="heading-lg">Large</option>
                            <option value="heading-xl">Extra large</option>
                        </Select>
                    </Field>
                    <Field
                        label="Title link"
                        hint="An internal path starting with /. The link shows only when a title is set."
                        className={styles.form_span}
                    >
                        <Input
                            id={`${formId}-title-url`}
                            size="sm"
                            value={titleUrl}
                            onChange={(e) => setTitleUrl(e.target.value)}
                            placeholder="/markets"
                            maxLength={512}
                            disabled={saving}
                        />
                    </Field>
                </div>
            </FormSection>

            <FormSection
                title="Settings"
                action={hasSchemaFields ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={rawMode ? exitRawMode : enterRawMode}
                        disabled={saving}
                    >
                        {rawMode ? 'Edit with form' : 'Edit as JSON'}
                    </Button>
                ) : undefined}
            >
                {renderSettings()}
            </FormSection>

            <div className={styles.form_footer}>
                {instanceConfigError && !rawMode && (
                    <span className={styles.form_footer_error} role="alert">
                        <AlertCircle size={14} aria-hidden />
                        {instanceConfigError}
                    </span>
                )}
                <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
                <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>
                    {mode === 'create' ? 'Place widget' : 'Save changes'}
                </Button>
            </div>
        </form>
    );
}
