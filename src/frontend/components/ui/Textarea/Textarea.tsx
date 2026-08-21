'use client';

import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';
import type { InputSize } from '../Input';
import styles from './Textarea.module.scss';

/**
 * Maps size prop values to their corresponding CSS Module class names.
 * Controls the padding density of the multiline field.
 */
const sizeClass: Record<InputSize, string> = {
    xs: styles['textarea--xs'],
    sm: styles['textarea--sm'],
    md: styles['textarea--md'],
    lg: styles['textarea--lg']
};

/**
 * TextareaProps defines the properties available for the Textarea component.
 *
 * Extends standard textarea attributes with a visual variant, mirroring the
 * Input and Select primitives so multiline fields stay visually consistent with
 * single-line inputs and dropdowns across admin surfaces.
 */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    /**
     * Visual style variant.
     * @default 'default'
     */
    variant?: 'default' | 'ghost';
    /**
     * Density of the field's padding, sharing the Input ladder so a multiline
     * field sits at the same visual weight as the single-line one beside it.
     * @default 'md'
     */
    size?: InputSize;
    /**
     * Marks the current value as rejected: the border and focus ring turn
     * danger and `aria-invalid` is set, matching the Input and Select
     * primitives so one form reads consistently when several of its controls
     * are refused at once.
     *
     * The rendered element is still a bare `<textarea>` with no wrapper. Use
     * `<Field>` to say why the value was rejected.
     *
     * @default false
     */
    invalid?: boolean;
}

/**
 * Textarea Component
 *
 * A themed multiline text field that replaces the bare native `<textarea>` used
 * ad-hoc across admin surfaces. Admin pages previously hand-rolled raw
 * `<textarea>` elements with colocated SCSS that duplicated the shared input
 * tokens; that drift is exactly what the Select normalization removed for
 * dropdowns. This wraps the native control with the same input tokens
 * (`--input-padding`, `--input-background`, `--input-border`, focus ring) so
 * every multiline field matches Input, Select, Button, and Badge.
 *
 * Supports all standard HTML textarea attributes (`rows`, `placeholder`,
 * `disabled`, etc.). The ghost variant provides a transparent background for
 * darker surfaces or overlay contexts.
 *
 * Wrapped in `forwardRef` so callers that imperatively focus or measure the
 * field (e.g. focusing the composer after loading a saved prompt) can attach a
 * ref to the underlying `<textarea>` — without that, ref-dependent consumers
 * would be unable to adopt the shared primitive and would stay bespoke.
 *
 * @example
 * ```tsx
 * <Textarea
 *   rows={4}
 *   placeholder="Describe the change..."
 *   value={notes}
 *   onChange={(e) => setNotes(e.target.value)}
 * />
 * ```
 *
 * @param props - Textarea properties including variant, size, and standard textarea attributes.
 * @param ref - Forwarded ref to the underlying `<textarea>` for imperative focus/measure.
 * @returns A styled textarea element with consistent focus behavior.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    function Textarea({ className, variant = 'default', size = 'md', invalid = false, ...props }, ref) {
        return (
            <textarea
                ref={ref}
                className={cn(
                    styles.textarea,
                    sizeClass[size],
                    variant === 'ghost' && styles['textarea--ghost'],
                    invalid && styles['textarea--invalid'],
                    className
                )}
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
