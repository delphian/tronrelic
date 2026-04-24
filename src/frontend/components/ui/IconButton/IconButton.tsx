'use client';

import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '../../../lib/cn';
import styles from './IconButton.module.css';

type IconButtonVariant = 'ghost' | 'primary' | 'danger' | 'success';
type IconButtonSize = 'sm' | 'md' | 'lg';

/**
 * Icon-only button primitive for inline row actions (edit, delete, copy) where
 * a bordered `<Button>` would visually dominate. Renders with no background
 * and no border by default; the icon color flips on hover according to the
 * chosen tone.
 *
 * `aria-label` is required because there is no visible text to describe the
 * action to assistive technology. Pass a Lucide icon (or any ReactNode) as
 * the single child; the component handles padding and focus state.
 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /**
     * Hover-color intent.
     * - ghost (default): muted text → text color on hover (neutral action)
     * - primary: muted text → primary color on hover (affirmative/edit/copy)
     * - danger: muted text → danger color on hover (destructive)
     * - success: muted text → success color on hover (confirm)
     */
    variant?: IconButtonVariant;
    /** Tap-target size — adjusts outer padding; the icon size is the caller's responsibility. */
    size?: IconButtonSize;
    /** Required accessible label describing the action. */
    'aria-label': string;
}

const variantClass: Record<IconButtonVariant, string> = {
    ghost: styles['icon-btn--ghost'],
    primary: styles['icon-btn--primary'],
    danger: styles['icon-btn--danger'],
    success: styles['icon-btn--success']
};

const sizeClass: Record<IconButtonSize, string> = {
    sm: styles['icon-btn--sm'],
    md: styles['icon-btn--md'],
    lg: styles['icon-btn--lg']
};

/**
 * @param props - IconButton props (variant, size, standard button attributes)
 * @returns A borderless, transparent icon-only button.
 */
export function IconButton({
    children,
    className,
    variant = 'ghost',
    size = 'md',
    type = 'button',
    ...props
}: PropsWithChildren<IconButtonProps>) {
    return (
        <button
            type={type}
            className={cn(styles['icon-btn'], variantClass[variant], sizeClass[size], className)}
            {...props}
        >
            {children}
        </button>
    );
}
