/**
 * @fileoverview Flexbox layout vocabulary shared by the zone layout panel,
 * the layout-group settings editor, and the zone layout strip.
 *
 * An `IZoneLayoutConfig` is four flex properties plus a gap and a collapse
 * breakpoint. Operators think in arrangements ("a centered row"), not in
 * `justify-content` values, so the editor offers named presets that set the
 * four flex fields at once, and shows CSS keywords with plain-English labels
 * wherever they surface. This file is the single home for those presets,
 * option lists, and labels so the three surfaces cannot drift apart.
 *
 * @module modules/widgets/lib/layoutPresets
 */

import type { IZoneLayoutConfig, ZoneLayoutPreset } from '@/types';

/**
 * Named arrangements the preset dropdown offers, each mapping to the four
 * flex properties. Gap and collapse are chosen separately, so presets leave
 * them untouched. `'custom'` is not in this map: it is the marker shown when
 * the operator hand-tunes a granular control past any preset.
 */
export const LAYOUT_PRESETS: Record<Exclude<ZoneLayoutPreset, 'custom'>, Omit<IZoneLayoutConfig, 'gap' | 'preset'>> = {
    'row-left': { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'nowrap' },
    'row-center': { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'nowrap' },
    'row-between': { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' },
    'row-right': { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'nowrap' },
    'row-wrap': { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'stretch', flexWrap: 'wrap' },
    'column': { flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch', flexWrap: 'nowrap' }
};

/** Preset dropdown options, in display order. */
export const PRESET_OPTIONS: ReadonlyArray<{ value: ZoneLayoutPreset; label: string }> = [
    { value: 'column', label: 'Stacked' },
    { value: 'row-left', label: 'Row, left' },
    { value: 'row-center', label: 'Row, centered' },
    { value: 'row-between', label: 'Row, spread out' },
    { value: 'row-right', label: 'Row, right' },
    { value: 'row-wrap', label: 'Row, wrapping' },
    { value: 'custom', label: 'Custom' }
];

/** Allowed values for each granular control, in display order. */
export const DIRECTION_OPTIONS = ['row', 'row-reverse', 'column', 'column-reverse'] as const;
export const JUSTIFY_OPTIONS = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const;
export const ALIGN_OPTIONS = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'] as const;
export const WRAP_OPTIONS = ['nowrap', 'wrap'] as const;
export const GAP_OPTIONS = ['none', 'sm', 'md', 'lg'] as const;

/**
 * Collapse-breakpoint options. The value is the `ZoneCollapseBreakpoint`
 * stored on the layout; the label spells out the pixel width so an operator
 * picks a threshold without memorising breakpoint names. `'never'` is first
 * because it is the default.
 */
export const COLLAPSE_OPTIONS: ReadonlyArray<{ value: NonNullable<IZoneLayoutConfig['collapseBelow']>; label: string }> = [
    { value: 'never', label: 'Never, stay a row' },
    { value: 'mobile-sm', label: 'Below 360px' },
    { value: 'mobile-md', label: 'Below 480px' },
    { value: 'mobile-lg', label: 'Below 768px' },
    { value: 'tablet', label: 'Below 1024px' },
    { value: 'desktop', label: 'Below 1200px' }
];

/** Valid `collapseBelow` values, taken from the options so the two cannot drift. */
export const COLLAPSE_VALUES = COLLAPSE_OPTIONS.map(option => option.value);

/**
 * Per-row relative-width options. The empty value clears `layoutWeight`
 * back to auto (content) width; the numbers set the flex weight so two rows
 * at 2× and 1× split a row two-thirds to one-third. Kept short because
 * finer ratios are rarely useful.
 */
export const WIDTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'Auto' },
    { value: '1', label: '1×' },
    { value: '2', label: '2×' },
    { value: '3', label: '3×' },
    { value: '4', label: '4×' }
];

/**
 * Operator-facing labels for enum values that are CSS keywords or design
 * token names. A schema enum such as `['flex-start', 'space-between']` is
 * what the renderer needs, but shown verbatim in a dropdown it reads as
 * code. The persisted value is never changed, only the option text. Values
 * not listed fall back to sentence-casing in {@link enumOptionLabel}.
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
 * Convert a property key into a readable label when the schema gives no
 * explicit title: splits camelCase and snake or kebab runs, then
 * sentence-cases the result (`showUndelegated` becomes "Show undelegated").
 *
 * @param key - Raw schema property name.
 * @returns Sentence-cased label.
 */
export function humanizeKey(key: string): string {
    const spaced = key
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim()
        .toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The text shown for one enum member. Looks the value up in the label map
 * first, then sentence-cases it, so a plugin's `'show_all'` reads "Show
 * all" without the plugin declaring anything. Non-string members are shown
 * by their string form, which is also how the select maps them back.
 *
 * @param member - One entry of a schema's `enum` array.
 * @returns The label to display.
 */
export function enumOptionLabel(member: unknown): string {
    const raw = String(member);
    return ENUM_VALUE_LABELS[raw] ?? humanizeKey(raw);
}

/**
 * Work out which named preset a layout matches, so a layout that never
 * recorded a preset still opens on the preset dropdown rather than "Custom".
 *
 * @param layout - The flex fields to compare against each preset.
 * @returns The matching preset name, or `'custom'` when none matches.
 */
export function detectPreset(layout: IZoneLayoutConfig): ZoneLayoutPreset {
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
 * The display name of a layout's active preset, used wherever a layout is
 * summarised in one word: the zone header's layout chip and the strip
 * caption.
 *
 * @param layout - The layout to summarise.
 * @returns The preset label, or "Custom".
 */
export function presetLabel(layout: IZoneLayoutConfig): string {
    const preset = layout.preset ?? detectPreset(layout);
    return PRESET_OPTIONS.find(option => option.value === preset)?.label ?? 'Custom';
}

/**
 * Whether a layout arranges its items along a row axis. Relative widths are
 * flex weights and only take effect along a row, so the editor hides the
 * width control in a column arrangement where it would be inert noise.
 *
 * @param layout - The layout to test.
 * @returns True for `row` and `row-reverse`.
 */
export function layoutIsRow(layout: IZoneLayoutConfig | null | undefined): boolean {
    return layout?.flexDirection === 'row' || layout?.flexDirection === 'row-reverse';
}

/**
 * Read a layout group's working `instanceConfig` as a complete
 * `IZoneLayoutConfig`. Each flex field is accepted only when it is one of
 * the known values and otherwise falls back to the schema default, so a
 * half-typed raw-JSON edit cannot put the editor into a state it cannot
 * render.
 *
 * @param value - The form's working config values for the layout group.
 * @returns A complete layout the editor and strip can display.
 */
export function toLayoutConfig(value: Record<string, unknown> | undefined): IZoneLayoutConfig {
    const source = value ?? {};

    /**
     * Accept a working value only when it is one of the allowed members.
     *
     * @param key - The config key to read.
     * @param allowed - The values the schema permits for that key.
     * @param fallback - The schema default used when the value is missing or invalid.
     * @returns The accepted member or the fallback.
     */
    const pick = <T extends string>(key: string, allowed: ReadonlyArray<T>, fallback: T): T => {
        const raw = source[key];
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
