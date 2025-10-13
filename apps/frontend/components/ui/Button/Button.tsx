'use client';

import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * ButtonProps interface defines the properties available for the Button component.
 *
 * Extends standard button attributes to support visual variants, size options,
 * icon integration, and loading states for consistent interactive controls.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /**
     * Visual style variant
     * @default 'primary'
     */
    variant?: ButtonVariant;
    /**
     * Size variant
     * @default 'md'
     */
    size?: ButtonSize;
    /**
     * Optional icon to display before the button text
     */
    icon?: ReactNode;
    /**
     * Loading state that disables interaction and shows loading text
     * @default false
     */
    loading?: boolean;
}

/**
 * Maps variant prop values to their corresponding CSS Module class names.
 * Controls the visual style and color scheme of the button.
 */
const variantClass: Record<ButtonVariant, string> = {
    primary: `${styles.btn} ${styles['btn--primary']}`,
    secondary: `${styles.btn} ${styles['btn--secondary']}`,
    ghost: `${styles.btn} ${styles['btn--ghost']}`,
    danger: `${styles.btn} ${styles['btn--danger']}`
};

/**
 * Maps size prop values to their corresponding CSS Module class names.
 * Controls the padding, height, and font size of the button.
 */
const sizeClass: Record<ButtonSize, string> = {
    sm: styles['btn--sm'],
    md: styles['btn--md'],
    lg: styles['btn--lg']
};

/**
 * Button Component
 *
 * A versatile interactive button component that provides consistent styling,
 * multiple visual variants, size options, and built-in loading states. Supports
 * icon integration and follows accessibility best practices with proper focus
 * management and disabled state handling.
 *
 * The loading state automatically disables the button and displays "Working…"
 * text to prevent duplicate submissions and provide user feedback during
 * asynchronous operations.
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="lg">
 *   Save Changes
 * </Button>
 * ```
 *
 * @example
 * ```tsx
 * <Button variant="ghost" icon={<SearchIcon />} loading={isSearching}>
 *   Search
 * </Button>
 * ```
 *
 * @param props - Button component properties including variant, size, and loading state
 * @returns A styled button element with consistent interactive behavior
 */
export function Button({
    children,
    className,
    variant = 'primary',
    size = 'md',
    icon,
    loading = false,
    disabled,
    ...props
}: PropsWithChildren<ButtonProps>) {
    const isDisabled = disabled || loading;

    return (
        <button
            className={cn(
                variantClass[variant],
                sizeClass[size],
                loading && styles['btn--loading'],
                className
            )}
            disabled={isDisabled || undefined}
            {...props}
        >
            {icon && <span className={styles.btn__icon}>{icon}</span>}
            <span>{loading ? 'Working…' : children}</span>
        </button>
    );
}
