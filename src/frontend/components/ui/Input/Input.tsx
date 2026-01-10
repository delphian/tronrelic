'use client';

import type { InputHTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Input.module.css';

/**
 * InputProps interface defines the properties available for the Input component.
 *
 * Extends standard input attributes to support visual variant selection for
 * consistent text input controls across different contexts.
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    /**
     * Visual style variant
     * @default 'default'
     */
    variant?: 'default' | 'ghost';
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
 * @param props - Input component properties including variant and standard input attributes
 * @returns A styled input element with consistent focus behavior
 */
export function Input({ className, variant = 'default', ...props }: InputProps) {
    return <input className={cn(variantClass[variant], className)} {...props} />;
}
