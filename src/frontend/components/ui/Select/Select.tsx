'use client';

import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/cn';
import type { InputSize } from '../Input';
import styles from './Select.module.css';

/**
 * SelectProps defines the properties available for the Select component.
 *
 * Extends standard select attributes with a visual variant and density,
 * mirroring the Input primitive so dropdowns and text inputs stay visually
 * consistent.
 *
 * The native `size` attribute (which turns the dropdown into a scrolling list
 * box) is omitted so the name can carry the design-system density, matching
 * Input and every other sized component.
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    /**
     * Visual style variant.
     * @default 'default'
     */
    variant?: 'default' | 'ghost';
    /**
     * Density of the control's padding, sharing the Input ladder so a dropdown
     * sits at the same visual weight as the field beside it.
     * @default 'md'
     */
    size?: InputSize;
}

/**
 * Maps size prop values to their corresponding CSS Module class names.
 * Controls the padding density of the dropdown.
 */
const sizeClass: Record<InputSize, string> = {
    xs: styles['select--xs'],
    sm: styles['select--sm'],
    md: styles['select--md'],
    lg: styles['select--lg']
};

/**
 * Select Component
 *
 * A themed dropdown that replaces the bare native `<select>` used ad-hoc across
 * admin surfaces. The native control renders inconsistently and too small for
 * the rest of the design system; this wraps it with the shared input tokens
 * (`--input-padding`, `--input-background`, `--input-border`, focus ring) and a
 * Lucide chevron so every dropdown matches Input, Button, and Badge. The native
 * `<select>` is preserved underneath for full keyboard, accessibility, and
 * mobile-picker behavior — only its appearance is restyled.
 *
 * Pass `<option>` / `<optgroup>` children as usual. The default width is
 * intrinsic (sized to the selected option), suiting inline filter bars. To make
 * it fill its container — e.g. a table cell — pass a `width: 100%` class via
 * `className`, which forwards to the wrapper (the layout-controlling element).
 *
 * @example
 * ```tsx
 * <Select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode">
 *     <option value="a">Option A</option>
 *     <option value="b">Option B</option>
 * </Select>
 * ```
 *
 * @param props - Select properties including variant, size, and standard select attributes.
 * @returns A styled select element wrapped with a chevron affordance.
 */
export function Select({ className, variant = 'default', size = 'md', children, ...props }: SelectProps) {
    return (
        <span className={cn(styles.wrapper, className)}>
            <select
                className={cn(styles.select, sizeClass[size], variant === 'ghost' && styles['select--ghost'])}
                {...props}
            >
                {children}
            </select>
            <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
        </span>
    );
}
