'use client';

import { forwardRef, type ButtonHTMLAttributes, type PropsWithChildren } from 'react';
import { cn } from '../../../lib/cn';
import styles from './IconButton.module.scss';

type IconButtonVariant = 'ghost' | 'primary' | 'danger' | 'success';
type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

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
    xs: styles['icon-btn--xs'],
    sm: styles['icon-btn--sm'],
    md: styles['icon-btn--md'],
    lg: styles['icon-btn--lg']
};

/**
 * Forwards its ref to the underlying `<button>`, because a caller that anchors
 * a floating panel to this control has to measure the real element and hand
 * focus back to it when the panel closes. Without the forward, such a caller
 * has to wrap the button in a positioning element and reach into the DOM for
 * the button inside it.
 *
 * @param props - IconButton props (variant, size, standard button attributes)
 * @param ref - Forwarded to the rendered `<button>`.
 * @returns A borderless, transparent icon-only button.
 */
export const IconButton = forwardRef<HTMLButtonElement, PropsWithChildren<IconButtonProps>>(
    function IconButton({
        children,
        className,
        variant = 'ghost',
        size = 'md',
        type = 'button',
        ...props
    }, ref) {
        return (
            <button
                ref={ref}
                type={type}
                className={cn(styles['icon-btn'], variantClass[variant], sizeClass[size], className)}
                {...props}
            >
                {children}
            </button>
        );
    }
);
