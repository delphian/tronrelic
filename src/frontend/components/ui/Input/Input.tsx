'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Input.module.scss';

/**
 * Density steps available to the Input, matching the shared `xs | sm | md | lg`
 * size-variant convention used by Button and Card.
 */
export type InputSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * InputProps interface defines the properties available for the Input component.
 *
 * Extends standard input attributes to support visual variant and density
 * selection for consistent text input controls across different contexts.
 *
 * The native `size` attribute (a character-width hint) is omitted so the name
 * can carry the design-system density instead — it is the convention every
 * other sized component follows, and the character-width behaviour it replaces
 * is unused here and better expressed with a width style.
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
    /**
     * Visual style variant
     * @default 'default'
     */
    variant?: 'default' | 'ghost';
    /**
     * Density of the field's padding. Pick the step matching the surrounding
     * visual weight — `xs` for dense inline filters, `md` for standard forms.
     * @default 'md'
     */
    size?: InputSize;
    /**
     * Marks the current value as rejected: the border and focus ring turn
     * danger and `aria-invalid` is set, so the state reaches assistive
     * technology rather than only the eye.
     *
     * It changes nothing structural. The rendered element is still a bare
     * `<input>` with no wrapper, because this control is frequently a flex or
     * grid item and introducing a wrapper only when a prop is set would move
     * the item its parent is laying out — the same component would produce two
     * different layouts depending on a prop. To say *why* the value was
     * rejected, wrap the control in `<Field>`, which owns the message and
     * wires `aria-describedby` to it.
     *
     * @default false
     */
    invalid?: boolean;
}

/**
 * Maps variant prop values to their corresponding CSS Module class names.
 * Controls the background and border styling of the input field.
 */
const variantClass: Record<NonNullable<InputProps['variant']>, string> = {
    default: styles.input,
    ghost: `${styles.input} ${styles['input--ghost']}`
};

/**
 * Maps size prop values to their corresponding CSS Module class names.
 * Controls the padding density of the input field.
 */
const sizeClass: Record<InputSize, string> = {
    xs: styles['input--xs'],
    sm: styles['input--sm'],
    md: styles['input--md'],
    lg: styles['input--lg']
};

/**
 * Input Component
 *
 * A text input component that provides consistent styling, focus management,
 * and visual variants for form controls throughout the application. Supports
 * all standard HTML input attributes and follows accessibility best practices
 * with proper focus indication.
 *
 * The ghost variant provides a transparent background suitable for integration
 * with darker surfaces or overlay contexts where standard input styling would
 * create visual separation.
 *
 * Wrapped in `forwardRef` so callers that imperatively focus or measure the
 * field can attach a ref to the underlying `<input>`. This keeps Input
 * symmetric with the Textarea primitive, which needs ref forwarding for focus
 * management — without it, ref-dependent consumers could not adopt the shared
 * primitive and would stay bespoke.
 *
 * @example
 * ```tsx
 * <Input
 *   placeholder="Enter your email"
 *   type="email"
 *   required
 * />
 * ```
 *
 * @example
 * ```tsx
 * <Input
 *   variant="ghost"
 *   placeholder="Search..."
 *   value={searchQuery}
 *   onChange={(e) => setSearchQuery(e.target.value)}
 * />
 * ```
 *
 * @param props - Input component properties including variant, size, invalid, and standard input attributes
 * @param ref - Forwarded ref to the underlying `<input>` for imperative focus/measure.
 * @returns A styled input element with consistent focus behavior
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
    function Input({ className, variant = 'default', size = 'md', invalid = false, ...props }, ref) {
        return (
            <input
                ref={ref}
                className={cn(variantClass[variant], sizeClass[size], invalid && styles['input--invalid'], className)}
                {...props}
                // Placed after the spread, and falling back rather than being
                // overwritten by it. An explicit caller value still wins, but
                // `{...props}` carries `aria-invalid` even when the caller
                // passed it as `undefined` — forwarding an optional override
                // does exactly that — and spreading it last would then delete
                // the derived value. The control would keep its danger border
                // while telling assistive technology nothing, which is the
                // failure this prop exists to prevent.
                aria-invalid={props['aria-invalid'] ?? (invalid || undefined)}
            />
        );
    }
);
