import type { HTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Card.module.css';

/**
 * CardProps interface defines the properties available for the Card component.
 *
 * Extends standard div attributes to support padding variants, elevation control,
 * visual tone selection, and background image control for consistent surface presentation.
 */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * Padding size variant
     * @default 'md'
     */
    padding?: 'sm' | 'md' | 'lg';
    /**
     * Enables elevated shadow effect
     * @default false
     */
    elevated?: boolean;
    /**
     * Visual tone variant for background styling
     * @default 'default'
     */
    tone?: 'default' | 'muted' | 'accent';
    /**
     * Disables the theme background image watermark for this card
     * @default false
     */
    noBackgroundImage?: boolean;
}

/**
 * Maps padding prop values to their corresponding CSS Module class names.
 * Ensures type-safe selection of padding variants.
 */
const paddingClass: Record<NonNullable<CardProps['padding']>, string> = {
    sm: styles['card--padding-sm'],
    md: styles['card--padding-md'],
    lg: styles['card--padding-lg']
};

/**
 * Maps tone prop values to their corresponding CSS Module class names.
 * Controls the visual appearance and background styling of the card.
 */
const toneClass: Record<NonNullable<CardProps['tone']>, string> = {
    default: styles.card,
    muted: `${styles.card} ${styles['card--muted']}`,
    accent: `${styles.card} ${styles['card--accent']}`
};

/**
 * Card Component
 *
 * A versatile container component that provides consistent surface elevation,
 * borders, and shadows throughout the application. Supports multiple padding
 * sizes, visual tones, elevation levels, and optional theme background images
 * for flexible UI composition.
 *
 * @example
 * ```tsx
 * <Card padding="lg" elevated>
 *   <h2>Dashboard</h2>
 * </Card>
 * ```
 *
 * @example
 * ```tsx
 * <Card tone="muted" padding="sm" noBackgroundImage>
 *   <p>Subtle background card without watermark</p>
 * </Card>
 * ```
 *
 * @param props - Card component properties
 * @returns A styled div element with surface styling
 */
export function Card({ className, padding = 'md', elevated = false, tone = 'default', noBackgroundImage = false, ...props }: CardProps) {
    return (
        <div
            className={cn(
                toneClass[tone],
                paddingClass[padding],
                elevated && styles['card--elevated'],
                noBackgroundImage && styles['card--no-bg-image'],
                className
            )}
            {...props}
        />
    );
}
