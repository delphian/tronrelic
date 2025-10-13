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
}

/**
 * Tooltip Component
 *
 * Displays a contextual tooltip with explanatory text when hovering over the trigger
 * element. The tooltip appears above the trigger with an arrow indicator and fades in
 * smoothly with animation. Positioning is centered above the trigger and includes
 * viewport boundary considerations.
 *
 * The tooltip automatically hides when the mouse leaves the trigger area and uses
 * pointer-events: none to prevent interference with mouse interaction. Max width is
 * constrained to maintain readability while supporting multi-line content.
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
 * <Tooltip content="Energy cost is calculated based on current network rates">
 *   <Info size={14} />
 * </Tooltip>
 * ```
 *
 * @param props.content - The text to display in the tooltip
 * @param props.children - The trigger element that activates the tooltip on hover
 * @returns A hoverable element with an absolutely positioned tooltip overlay
 */
export function Tooltip({ content, children }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <span
            className={styles.trigger}
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <span className={styles.content}>
                    {content}
                    <span className={styles.arrow} />
                </span>
            )}
        </span>
    );
}
