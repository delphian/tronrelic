'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback } from 'react';
import { cn } from '../../../lib/cn';

/**
 * One selectable segment.
 *
 * `onSelect` exists because a real toolbar rarely wants uniform behavior: the
 * NetworkActivity / ResourceDelegations / DustActivity widgets pin their
 * rotation timer when the *metric* changes but refetch a series when the
 * *window* changes, and a mixed group may need one segment to do something the
 * others don't. Per-option callbacks keep that flexibility without forcing the
 * consumer to branch on the id inside a single handler.
 */
export interface ISegmentedControlOption<T extends string> {
    /** Stable identifier compared against `value` to derive the active segment. */
    id: T;
    /** Visible content — usually a short label like `24h`; may include an icon. */
    label: ReactNode;
    /** Blocks selection and dims the segment while keeping it visible for context. */
    disabled?: boolean;
    /** Accessible name for when `label` is an icon or an abbreviation a screen reader would mangle. */
    ariaLabel?: string;
    /** Native tooltip text for abbreviations that need expanding on hover. */
    title?: string;
    /** `aria-controls` target id — set in `variant="tablist"` so assistive tech can pair tab and panel. */
    controls?: string;
    /** Per-option side effect, invoked after `onChange` when this segment is selected. */
    onSelect?: (id: T) => void;
}

export interface ISegmentedControlProps<T extends string> {
    /** Segments in display order; also the order arrow keys traverse. */
    options: ReadonlyArray<ISegmentedControlOption<T>>;
    /** Currently active option id — the control is fully controlled by the caller. */
    value: T;
    /** Called with the newly selected id before that option's own `onSelect`. */
    onChange?: (id: T) => void;
    /** Accessible name for the group, e.g. `Time window`. Required so the control never reads as a bare button row. */
    label: string;
    /**
     * `group` for a filter/toggle row (`aria-pressed` per segment); `tablist`
     * when the segments switch panels in place (`role="tab"` + `aria-selected`).
     * @default 'group'
     */
    variant?: 'group' | 'tablist';
    /** Disables every segment — use while a fetch the control would re-trigger is in flight. */
    disabled?: boolean;
    /** Re-fire callbacks when the already-active segment is clicked; off by default so consumers need no self-guard. */
    reselect?: boolean;
    /** Extra class on the container for spacing or container-query hooks. */
    className?: string;
}

/**
 * Compact segmented toggle for the chart and toolbar controls that recur across
 * the app — time windows, metric pickers, chart views, data-source switches.
 *
 * The pattern was hand-rolled at eighteen call sites (raw `<button>` rows over
 * the `.segmented-control` utility), which is how behavior drifted: some rows
 * shipped `aria-pressed`, some shipped nothing, and one admin section grew its
 * own local `.window_button` styling that no longer matched the rest. Owning it
 * in one primitive fixes the ARIA and keyboard story once and gives every
 * consumer arrow-key traversal that none of the hand-rolled rows had.
 *
 * Styling deliberately stays on the global `.segmented-control` utility instead
 * of a colocated module, so this component and the remaining hand-rolled call
 * sites stay pixel-identical during migration and a theme keeps one set of
 * `--segmented-control-*` tokens to override.
 *
 * Purely presentational and fully controlled: it holds no state and fetches
 * nothing, so it renders identically on server and client and is safe inside an
 * SSR-first component tree.
 *
 * @example
 * ```tsx
 * <SegmentedControl
 *     label="Time window"
 *     value={window}
 *     options={WINDOWS}
 *     onChange={handleWindow}
 * />
 * ```
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    label,
    variant = 'group',
    disabled = false,
    reselect = false,
    className
}: ISegmentedControlProps<T>) {
    const isTablist = variant === 'tablist';

    /**
     * Route a selection to the caller. Suppressing a click on the already-active
     * segment by default matters because consumers wire `onChange` straight to a
     * refetch — without the guard, tapping the current window would spawn a
     * redundant request on every press.
     *
     * @param option - The clicked segment, carrying its optional per-item hook.
     */
    const select = useCallback((option: ISegmentedControlOption<T>) => {
        if (option.disabled || (option.id === value && !reselect)) {
            return;
        }
        onChange?.(option.id);
        option.onSelect?.(option.id);
    }, [onChange, reselect, value]);

    /**
     * Move selection with the arrow keys so the control is operable without a
     * pointer — the behavior ARIA expects of a tablist, and what users expect of
     * a segmented control generally. Focus follows the new segment so the next
     * arrow press continues from it; disabled segments are stepped over.
     *
     * @param event - Keydown on the container, also used to locate sibling buttons.
     */
    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0 || disabled) {
            return;
        }
        const current = options.findIndex(option => option.id === value);
        let next = current;
        // Walk past disabled segments rather than stalling on them, and bound the
        // scan by the option count so an all-disabled group cannot spin.
        for (let hop = 0; hop < options.length; hop += 1) {
            next = (next + step + options.length) % options.length;
            if (!options[next].disabled) {
                break;
            }
        }
        if (next === current) {
            return;
        }
        event.preventDefault();
        select(options[next]);
        const buttons = event.currentTarget.querySelectorAll('button');
        buttons[next]?.focus();
    }, [disabled, options, select, value]);

    return (
        <div
            className={cn('segmented-control', className)}
            role={isTablist ? 'tablist' : 'group'}
            aria-label={label}
            onKeyDown={handleKeyDown}
        >
            {options.map(option => {
                const active = option.id === value;
                return (
                    <button
                        key={option.id}
                        type="button"
                        role={isTablist ? 'tab' : undefined}
                        className={active ? 'is-active' : undefined}
                        disabled={disabled || option.disabled}
                        title={option.title}
                        aria-label={option.ariaLabel}
                        aria-controls={option.controls}
                        aria-pressed={isTablist ? undefined : active}
                        aria-selected={isTablist ? active : undefined}
                        onClick={() => select(option)}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
