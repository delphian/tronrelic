import type { HTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Badge.module.css';

/**
 * BadgeProps interface defines the properties available for the Badge component.
 *
 * Extends standard span attributes to support visual tone variants for displaying
 * status information, labels, and categorical indicators.
 */
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    /**
     * Visual tone variant for status indication
     * @default 'neutral'
     */
    tone?: 'neutral' | 'success' | 'warning' | 'danger';

    /**
     * Whether to display a pulsing red recording indicator dot before the badge content.
     * Used to emphasize real-time/live status and draw attention to actively updating content.
     * @default false
     */
    showLiveIndicator?: boolean;
}

/**
 * Maps tone prop values to their corresponding CSS Module class names.
 * Controls the color scheme and visual feedback of the badge.
 */
const toneClass: Record<NonNullable<BadgeProps['tone']>, string> = {
    neutral: `${styles.badge} ${styles['badge--neutral']}`,
    success: `${styles.badge} ${styles['badge--success']}`,
    warning: `${styles.badge} ${styles['badge--warning']}`,
    danger: `${styles.badge} ${styles['badge--danger']}`
};

/**
 * Badge Component
 *
 * A compact inline component that displays status indicators, labels, and
 * categorical information with color-coded visual feedback. Commonly used
 * for real-time connection status, notification counts, and data categorization.
 *
 * @example
 * ```tsx
 * <Badge tone="success">Connected</Badge>
 * ```
 *
 * @example
 * ```tsx
 * <Badge tone="success" showLiveIndicator>
 *   Live
 * </Badge>
 * ```
 *
 * @example
 * ```tsx
 * <Badge tone="warning">
 *   <Icon name="alert" size={12} />
 *   Limited availability
 * </Badge>
 * ```
 *
 * @param props - Badge component properties including tone variant, live indicator flag, and children
 * @returns A styled span element with badge styling
 */
export function Badge({ tone = 'neutral', showLiveIndicator = false, children, className, ...props }: PropsWithChildren<BadgeProps>) {
    return (
        <span className={cn(toneClass[tone], className)} {...props}>
            {showLiveIndicator && <span className={styles.live_indicator} aria-hidden="true" />}
            {children}
        </span>
    );
}
