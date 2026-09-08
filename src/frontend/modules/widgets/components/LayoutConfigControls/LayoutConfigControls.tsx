'use client';

/**
 * @fileoverview Shared flexbox layout editor.
 *
 * A zone and a layout group are arranged by the same `IZoneLayoutConfig`,
 * so one editor serves both: the zone's layout panel on the board and the
 * settings section of a layout group in the editor panel. Operators pick a
 * named arrangement first; the four flex axes sit under a "fine-tune"
 * heading for the rare case a preset is not enough. Touching a fine-tune
 * control re-tags the layout as custom so the preset dropdown never claims
 * an arrangement it no longer matches.
 *
 * @module modules/widgets/components/LayoutConfigControls
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { IZoneLayoutConfig, ZoneLayoutPreset } from '@/types';
import { Select } from '../../../../components/ui/Select';
import { Textarea } from '../../../../components/ui/Textarea';
import {
    ALIGN_OPTIONS,
    COLLAPSE_OPTIONS,
    DIRECTION_OPTIONS,
    GAP_OPTIONS,
    JUSTIFY_OPTIONS,
    LAYOUT_PRESETS,
    PRESET_OPTIONS,
    WRAP_OPTIONS,
    enumOptionLabel
} from '../../lib/layoutPresets';
import styles from './LayoutConfigControls.module.scss';

/**
 * Props for the shared layout editor.
 */
export interface ILayoutConfigControlsProps {
    /** Prefix for control ids, unique per host so labels pair with the right control. */
    idPrefix: string;
    /** The current effective layout. */
    layout: IZoneLayoutConfig;
    /** Whether the controls are inert because a write is in flight. */
    disabled: boolean;
    /** Receives the whole new config on every edit. */
    onChange: (config: IZoneLayoutConfig) => void;
    /** Extra host-specific controls rendered after the shared ones. */
    children?: ReactNode;
}

/**
 * Preset dropdown plus gap and collapse, with the four flex axes under a
 * fine-tune heading.
 *
 * @param props - See {@link ILayoutConfigControlsProps}.
 * @returns The editor.
 */
export function LayoutConfigControls({ idPrefix, layout, disabled, onChange, children }: ILayoutConfigControlsProps) {
    /**
     * Apply a preset: spread its flex fields over the current config, keep
     * the operator's gap and collapse, and stamp the preset name.
     *
     * @param preset - Selected preset value.
     */
    const applyPreset = (preset: ZoneLayoutPreset) => {
        if (preset === 'custom') {
            onChange({ ...layout, preset: 'custom' });
        } else {
            onChange({ ...layout, ...LAYOUT_PRESETS[preset], preset });
        }
    };

    /**
     * Apply one field. A flex-axis edit re-tags the config as custom; gap
     * and collapse do not belong to a preset, so they keep the label.
     *
     * @param patch - The single field being changed.
     * @param keepPreset - True for gap and collapse.
     */
    const applyGranular = (patch: Partial<IZoneLayoutConfig>, keepPreset: boolean) => {
        onChange({ ...layout, ...patch, preset: keepPreset ? layout.preset : 'custom' });
    };

    return (
        <div className={styles.layout}>
            <div className={styles.group}>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={`${idPrefix}-preset`}>Arrangement</label>
                    <Select
                        id={`${idPrefix}-preset`}
                        size="sm"
                        value={layout.preset ?? 'custom'}
                        onChange={(e) => applyPreset(e.target.value as ZoneLayoutPreset)}
                        disabled={disabled}
                    >
                        {PRESET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                </div>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={`${idPrefix}-gap`}>Gap</label>
                    <Select
                        id={`${idPrefix}-gap`}
                        size="sm"
                        value={layout.gap}
                        onChange={(e) => applyGranular({ gap: e.target.value as IZoneLayoutConfig['gap'] }, true)}
                        disabled={disabled}
                    >
                        {GAP_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                    </Select>
                </div>
                <div className={styles.field}>
                    <label className={styles.label} htmlFor={`${idPrefix}-collapse`}>Stack on narrow screens</label>
                    <Select
                        id={`${idPrefix}-collapse`}
                        size="sm"
                        value={layout.collapseBelow ?? 'never'}
                        onChange={(e) => applyGranular({ collapseBelow: e.target.value as IZoneLayoutConfig['collapseBelow'] }, true)}
                        disabled={disabled}
                    >
                        {COLLAPSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                </div>
            </div>

            <details className={styles.advanced}>
                <summary className={styles.advanced_summary}>Fine-tune the arrangement</summary>
                <div className={styles.group}>
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor={`${idPrefix}-dir`}>Direction</label>
                        <Select
                            id={`${idPrefix}-dir`}
                            size="sm"
                            value={layout.flexDirection}
                            onChange={(e) => applyGranular({ flexDirection: e.target.value as IZoneLayoutConfig['flexDirection'] }, false)}
                            disabled={disabled}
                        >
                            {DIRECTION_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                        </Select>
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor={`${idPrefix}-justify`}>Along the row</label>
                        <Select
                            id={`${idPrefix}-justify`}
                            size="sm"
                            value={layout.justifyContent}
                            onChange={(e) => applyGranular({ justifyContent: e.target.value as IZoneLayoutConfig['justifyContent'] }, false)}
                            disabled={disabled}
                        >
                            {JUSTIFY_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                        </Select>
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor={`${idPrefix}-align`}>Across the row</label>
                        <Select
                            id={`${idPrefix}-align`}
                            size="sm"
                            value={layout.alignItems}
                            onChange={(e) => applyGranular({ alignItems: e.target.value as IZoneLayoutConfig['alignItems'] }, false)}
                            disabled={disabled}
                        >
                            {ALIGN_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                        </Select>
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor={`${idPrefix}-wrap`}>Wrapping</label>
                        <Select
                            id={`${idPrefix}-wrap`}
                            size="sm"
                            value={layout.flexWrap}
                            onChange={(e) => applyGranular({ flexWrap: e.target.value as IZoneLayoutConfig['flexWrap'] }, false)}
                            disabled={disabled}
                        >
                            {WRAP_OPTIONS.map(o => <option key={o} value={o}>{enumOptionLabel(o)}</option>)}
                        </Select>
                    </div>
                </div>
            </details>

            {children}
        </div>
    );
}

/**
 * Locally buffered textarea for a zone's custom CSS. Committing on blur
 * rather than every keystroke keeps CSS edits from firing a write per
 * character; the draft re-syncs when the server value changes underneath
 * it, for example after another admin's edit lands over the WebSocket.
 *
 * @param props.id - Element id for the textarea and label pairing.
 * @param props.value - The zone's persisted CSS, or an empty string.
 * @param props.disabled - Whether the field is inert.
 * @param props.onCommit - Called with the new value on blur, only on change.
 * @returns The textarea.
 */
function ZoneCustomCssField({ id, value, disabled, onCommit }: {
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
            size="sm"
            rows={4}
            value={draft}
            maxLength={4000}
            spellCheck={false}
            className={styles.css_textarea}
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
 * Props for the zone-specific layout controls.
 */
export interface IZoneLayoutControlsProps {
    /** Zone these controls edit. */
    zoneId: string;
    /** The zone's current effective layout. */
    layout: IZoneLayoutConfig;
    /** Whether the controls are inert. */
    disabled: boolean;
    /** Persists the new config for the zone. */
    onChange: (zoneId: string, config: IZoneLayoutConfig) => void;
}

/**
 * The shared editor plus the custom CSS block only a zone supports.
 *
 * @param props - See {@link IZoneLayoutControlsProps}.
 * @returns The zone layout panel body.
 */
export function ZoneLayoutControls({ zoneId, layout, disabled, onChange }: IZoneLayoutControlsProps) {
    return (
        <LayoutConfigControls
            idPrefix={`zl-${zoneId}`}
            layout={layout}
            disabled={disabled}
            onChange={(config) => onChange(zoneId, config)}
        >
            <details className={styles.advanced}>
                <summary className={styles.advanced_summary}>Custom CSS for this zone</summary>
                <div className={styles.css_block}>
                    <ZoneCustomCssField
                        id={`zl-${zoneId}-css`}
                        value={layout.customCss ?? ''}
                        disabled={disabled}
                        onCommit={(css) => onChange(zoneId, { ...layout, customCss: css.trim().length > 0 ? css : undefined })}
                    />
                    <span className={styles.css_note}>
                        Declarations only, no selector. Applied to the zone container as{' '}
                        <code>[data-zone=&quot;{zoneId}&quot;] {'{ … }'}</code> and checked for syntax when saved.
                    </span>
                </div>
            </details>
        </LayoutConfigControls>
    );
}
