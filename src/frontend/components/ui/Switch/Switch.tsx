'use client';

import type { ButtonHTMLAttributes } from 'react';
import { ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '../../../lib/cn';
import styles from './Switch.module.css';

type SwitchSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Icon-rendered on/off toggle. Flips `on` state on click; the icon and color
 * reflect current state (right+success when on, left+muted when off). Use
 * when a row-level control represents a boolean state (tool enable/disable,
 * feature flag, notification on/off).
 *
 * Unlike `<IconButton>`, color is state-driven (not hover-driven) and the
 * icon itself swaps — so hover has no visual effect by design. The button
 * carries `role="switch"` + `aria-checked` so assistive tech reads it as a
 * toggle rather than a generic button.
 */
export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'aria-checked'> {
    /** Current on/off state. */
    on: boolean;
    /** Called with the new state when the user toggles. */
    onChange: (next: boolean) => void;
    /** Tap-target size; also scales the rendered icon. @default 'md' */
    size?: SwitchSize;
    /** Required accessible label describing what is being toggled. */
    'aria-label': string;
}

const sizeClass: Record<SwitchSize, string> = {
    xs: styles['switch--xs'],
    sm: styles['switch--sm'],
    md: styles['switch--md'],
    lg: styles['switch--lg']
};

/**
 * Icon pixel sizes aligned to the design-system `--icon-size-*` ladder in
 * primitives.scss — one rung larger than the old mapping (sm=`--icon-size-md`,
 * md=`--icon-size-lg`, lg=`--icon-size-xl`) so the toggle reads as a deliberate
 * control rather than a faint glyph. The previous 18/20/24 ladder was too small
 * to communicate state at a glance in a dense table row. Hardcoded here because
 * CSS custom properties can't be read synchronously by the lucide-react `size`
 * prop. `xs` continues the ladder one rung down at `--icon-size-sm`.
 */
const iconSize: Record<SwitchSize, number> = {
    xs: 18,
    sm: 20,
    md: 24,
    lg: 32
};

/**
 * Stroke weights per state. A heavier stroke when `on` makes the active
 * (success-colored) toggle visually assertive, while the lighter `off` stroke
 * keeps an inactive control quiet — so the two states differ in weight as well
 * as color and knob position, the redundancy the old single-weight icon lacked.
 */
const strokeWidth: Record<'on' | 'off', number> = {
    on: 2.5,
    off: 2
};

/**
 * @param props - Switch props (on/onChange required; size; standard button attributes)
 * @returns A role="switch" button rendering ToggleRight/ToggleLeft based on state.
 */
export function Switch({
    on,
    onChange,
    size = 'md',
    disabled,
    className,
    type = 'button',
    onClick,
    ...props
}: SwitchProps) {
    const Icon = on ? ToggleRight : ToggleLeft;
    return (
        <button
            {...props}
            type={type}
            role="switch"
            aria-checked={on}
            disabled={disabled}
            className={cn(
                styles.switch,
                sizeClass[size],
                on ? styles['switch--on'] : styles['switch--off'],
                className
            )}
            onClick={(event) => {
                onClick?.(event);
                if (!event.defaultPrevented) {
                    onChange(!on);
                }
            }}
        >
            <Icon size={iconSize[size]} strokeWidth={on ? strokeWidth.on : strokeWidth.off} />
        </button>
    );
}
