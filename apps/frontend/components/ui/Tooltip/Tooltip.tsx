'use client';

import { useState, type ReactNode } from 'react';
import styles from './Tooltip.module.css';

/**
 * Tooltip props interface defining trigger and content configuration.
 *
 * Controls the explanatory text displayed on hover and the trigger element
 * that activates the tooltip.
 */
interface TooltipProps {
    /** Text content to display in the tooltip overlay */
    content: string;
    /** Trigger element that activates the tooltip on hover */
    children: ReactNode;
    /** Placement of the tooltip relative to the trigger (default: 'top') */
    placement?: 'top' | 'bottom';
}

/**
 * Tooltip Component
 *
 * Displays a contextual tooltip with explanatory text when hovering over the trigger
 * element. The tooltip can appear above or below the trigger with an arrow indicator
 * and fades in smoothly with animation. Positioning is centered relative to the trigger
 * and includes viewport boundary considerations.
 *
 * The tooltip automatically hides when the mouse leaves the trigger area and uses
 * pointer-events: none to prevent interference with mouse interaction. Max width is
 * constrained to maintain readability while supporting multi-line content.
 *
 * Use `placement="bottom"` when the tooltip appears in a container with overflow
 * constraints (like table headers with horizontal scroll) to prevent clipping.
 *
 * @example
 * ```tsx
 * <Tooltip content="Click to refresh data">
 *   <button>Refresh</button>
 * </Tooltip>
 * ```
 *
 * @example
 * ```tsx
 * <Tooltip content="Energy cost is calculated based on current network rates" placement="bottom">
 *   <Info size={14} />
 * </Tooltip>
 * ```
 *
 * @param props.content - The text to display in the tooltip
 * @param props.children - The trigger element that activates the tooltip on hover
 * @param props.placement - Position of the tooltip relative to the trigger ('top' | 'bottom')
 * @returns A hoverable element with an absolutely positioned tooltip overlay
 */
export function Tooltip({ content, children, placement = 'top' }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <span
            className={styles.trigger}
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <span className={`${styles.content} ${placement === 'bottom' ? styles.content_bottom : ''}`}>
                    {content}
                    <span className={`${styles.arrow} ${placement === 'bottom' ? styles.arrow_bottom : ''}`} />
                </span>
            )}
        </span>
    );
}
