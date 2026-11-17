'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '../../../lib/cn';
import styles from './Switch.module.scss';

type SwitchSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * The props every switch takes, whichever way it is named.
 *
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
interface ISwitchBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'aria-checked' | 'aria-label'> {
    /** Current on/off state. */
    on: boolean;
    /** Called with the new state when the user toggles. */
    onChange: (next: boolean) => void;
    /** Tap-target size; also scales the rendered icon. @default 'md' */
    size?: SwitchSize;
}

/**
 * SwitchProps — a switch must be named, either by visible text or by an
 * `aria-label`, and the type demands one of the two.
 *
 * `label` draws the text beside the icon, inside the button, so the words and
 * the switch move together when a row wraps and clicking the words flips the
 * switch. The text is then the switch's accessible name, so `aria-label` is
 * optional; set one only when a screen reader needs more than the visible
 * words say, and start it with those words so a voice user can still say
 * what they see. Without `label` the switch is icon-only and `aria-label` is
 * required, because a control with no name is unusable with a screen reader.
 *
 * Use `label` for a switch that stands on its own, such as a toolbar toggle.
 * For a switch that also needs a line of guidance under it, wrap it in
 * `<Field inline label hint>` instead, and leave `label` off the switch.
 */
export type SwitchProps = ISwitchBaseProps & (
    | {
        /**
         * Visible text drawn beside the icon; it names the switch. Excludes
         * the values React draws as nothing, so `label={undefined}` cannot
         * stand in for a name and skip the `aria-label` requirement.
         */
        label: Exclude<ReactNode, null | undefined | boolean>;
        /** Optional, longer name for assistive technology. */
        'aria-label'?: string;
    }
    | {
        label?: undefined;
        /** Required accessible label describing what is being toggled. */
        'aria-label': string;
    }
);

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
 * Render a toggle whose icon, colour, and `aria-checked` follow `on`.
 *
 * @param props - Switch props: `on` and `onChange`, a name through `label` or
 * `aria-label`, an optional `size`, and standard button attributes.
 * @returns A role="switch" button rendering ToggleRight/ToggleLeft based on
 * state, followed by the visible label when one is given.
 */
export function Switch({
    on,
    onChange,
    size = 'md',
    label,
    disabled,
    className,
    type = 'button',
    onClick,
    ...props
}: SwitchProps) {
    const Icon = on ? ToggleRight : ToggleLeft;
    // An empty string is still a string, so the type lets it through; it would
    // draw an empty span and leave the switch with no name, so treat it as no
    // label at all.
    const labelled = label !== undefined && label !== '';
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
                labelled && styles['switch--labelled'],
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
            {labelled && <span className={styles.switch__label}>{label}</span>}
        </button>
    );
}
