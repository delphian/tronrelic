'use client';

import type { ButtonHTMLAttributes } from 'react';
import { ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '../../../lib/cn';
import styles from './Switch.module.css';

type SwitchSize = 'sm' | 'md' | 'lg';

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
    sm: styles['switch--sm'],
    md: styles['switch--md'],
    lg: styles['switch--lg']
};

const iconSize: Record<SwitchSize, number> = {
    sm: 20,
    md: 24,
    lg: 32
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
            {...props}
        >
            <Icon size={iconSize[size]} />
        </button>
    );
}
