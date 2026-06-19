'use client';

import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/cn';
import styles from './Select.module.css';

/**
 * SelectProps defines the properties available for the Select component.
 *
 * Extends standard select attributes with a visual variant, mirroring the
 * Input primitive so dropdowns and text inputs stay visually consistent.
 */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    /**
     * Visual style variant.
     * @default 'default'
     */
    variant?: 'default' | 'ghost';
}

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
 * @param props - Select properties including variant and standard select attributes.
 * @returns A styled select element wrapped with a chevron affordance.
 */
export function Select({ className, variant = 'default', children, ...props }: SelectProps) {
    return (
        <span className={cn(styles.wrapper, className)}>
            <select
                className={cn(styles.select, variant === 'ghost' && styles['select--ghost'])}
                {...props}
            >
                {children}
            </select>
            <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
        </span>
    );
}
