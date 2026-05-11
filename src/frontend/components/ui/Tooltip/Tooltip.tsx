'use client';

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import styles from './Tooltip.module.css';

/**
 * Tooltip props interface defining trigger and content configuration.
 *
 * Controls the explanatory text displayed on hover/tap and the trigger
 * element that activates the tooltip.
 */
interface TooltipProps {
    /** Text content to display in the tooltip overlay */
    content: string;
    /** Trigger element that activates the tooltip on hover/tap */
    children: ReactNode;
    /** Placement of the tooltip relative to the trigger (default: 'top') */
    placement?: 'top' | 'bottom';
}

/**
 * Tooltip Component
 *
 * Displays a contextual tooltip with explanatory text. On mouse devices the
 * tooltip appears on hover; on touch devices it toggles on tap and dismisses
 * on tap-outside, since synthesized hover events do not work reliably across
 * mobile browsers. Hover and tap behaviors are dispatched separately based
 * on `PointerEvent.pointerType` so neither input mode interferes with the
 * other.
 *
 * Use `placement="bottom"` when the tooltip appears in a container with
 * overflow constraints (like table headers with horizontal scroll) to
 * prevent clipping.
 *
 * @example
 * ```tsx
 * <Tooltip content="Click to refresh data">
 *   <button>Refresh</button>
 * </Tooltip>
 * ```
 */
export function Tooltip({ content, children, placement = 'top' }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const triggerRef = useRef<HTMLSpanElement | null>(null);

    function handlePointerEnter(event: PointerEvent<HTMLSpanElement>) {
        if (event.pointerType === 'mouse') {
            setIsVisible(true);
        }
    }

    function handlePointerLeave(event: PointerEvent<HTMLSpanElement>) {
        if (event.pointerType === 'mouse') {
            setIsVisible(false);
        }
    }

    function handleClick() {
        setIsVisible(prev => !prev);
    }

    // Close on outside tap so a touch user can dismiss without finding a
    // second tap target on the trigger itself. Listener is attached only
    // while the tooltip is open, so it is a no-op for hover-driven sessions.
    useEffect(() => {
        if (!isVisible) return undefined;
        function handleDocumentPointerDown(event: globalThis.PointerEvent) {
            const trigger = triggerRef.current;
            if (trigger && !trigger.contains(event.target as Node)) {
                setIsVisible(false);
            }
        }
        document.addEventListener('pointerdown', handleDocumentPointerDown);
        return () => document.removeEventListener('pointerdown', handleDocumentPointerDown);
    }, [isVisible]);

    return (
        <span
            ref={triggerRef}
            className={styles.trigger}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            onClick={handleClick}
        >
            {children}
            {isVisible && (
                <span
                    role="tooltip"
                    className={`${styles.content} ${placement === 'bottom' ? styles.content_bottom : ''}`}
                >
                    {content}
                    <span className={`${styles.arrow} ${placement === 'bottom' ? styles.arrow_bottom : ''}`} />
                </span>
            )}
        </span>
    );
}
