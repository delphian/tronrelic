import type { HTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '../../../lib/cn';
import styles from './Badge.module.scss';

/**
 * Visual tone variants a Badge can render. Exported so callers that map their
 * own domain status onto a badge (platform health, job state) can type that
 * mapping against the component instead of restating the union locally.
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * Density steps a Badge can render at, sharing the xs/sm/md/lg names the button
 * and input ladders use so a caller sizes a badge the same way it sizes any
 * other control. Exported for the same reason `BadgeTone` is: a caller that
 * picks a step from its own layout state can type that choice against the
 * component rather than restating the union.
 */
export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

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
    tone?: BadgeTone;

    /**
     * How much padding surrounds the label. Pass a smaller step when badges sit
     * in a dense list — a sidebar, a table cell, a narrow rail — where the pill
     * at full size takes more width than the word inside it deserves. The text
     * itself does not shrink: the badge font already sits at the design
     * system's legibility floor, so only the pill moves.
     * @default 'md'
     */
    size?: BadgeSize;

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
    info: `${styles.badge} ${styles['badge--info']}`,
    success: `${styles.badge} ${styles['badge--success']}`,
    warning: `${styles.badge} ${styles['badge--warning']}`,
    danger: `${styles.badge} ${styles['badge--danger']}`
};

/**
 * Maps size prop values to their corresponding CSS Module class names.
 * Controls how much padding surrounds the badge's label.
 *
 * One of these always applies, because `size` defaults to 'md'. That matters:
 * the base `.badge` class carries no padding of its own, so a badge rendered
 * without a size class would collapse onto its text.
 */
const sizeClass: Record<BadgeSize, string> = {
    xs: styles['badge--xs'],
    sm: styles['badge--sm'],
    md: styles['badge--md'],
    lg: styles['badge--lg']
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
 * @example Dense list — a narrow rail or a table cell, where the default pill
 * takes more width than the label needs.
 * ```tsx
 * <Badge tone="info" size="sm">Scheduled</Badge>
 * ```
 *
 * @param props - Badge component properties including tone variant, density step, live indicator flag, and children
 * @returns A styled span element with badge styling
 */
export function Badge({ tone = 'neutral', size = 'md', showLiveIndicator = false, children, className, ...props }: PropsWithChildren<BadgeProps>) {
    return (
        <span className={cn(toneClass[tone], sizeClass[size], className)} {...props}>
            {showLiveIndicator && <span className={styles.live_indicator} aria-hidden="true" />}
            {children}
        </span>
    );
}
