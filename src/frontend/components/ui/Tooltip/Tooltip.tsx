'use client';

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent,
    type ReactNode
} from 'react';
import styles from './Tooltip.module.css';

/**
 * Minimum horizontal gap between the tooltip and the viewport edges. Picks
 * up just enough breathing room so the tooltip never visually butts against
 * a window border but stays close to the trigger when one edge is tight.
 */
const VIEWPORT_PADDING_PX = 8;

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
 * Horizontal viewport clamping: after the tooltip mounts the layout effect
 * measures it via `getBoundingClientRect()` and, if it would overflow the
 * viewport on either side, sets `--tooltip-shift-x` on the content element
 * so CSS shifts the tooltip back inside (and the arrow stays anchored to
 * the trigger). Trigger-centered tooltips near a screen edge would
 * otherwise be clipped or pushed off-screen.
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
    const [shiftX, setShiftX] = useState(0);
    const triggerRef = useRef<HTMLSpanElement | null>(null);
    const contentRef = useRef<HTMLSpanElement | null>(null);

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

    // Measure the rendered tooltip against the viewport and shift it inward
    // if either edge would clip. Runs in `useLayoutEffect` so the corrected
    // position is in place before the browser paints — measuring after paint
    // would briefly show the tooltip clipped. Re-runs when `content`
    // changes since the rendered width depends on it, and re-runs on window
    // resize so a tooltip that stays open through a viewport change does
    // not become stale.
    useLayoutEffect(() => {
        if (!isVisible) {
            setShiftX(0);
            return;
        }

        function updateShift() {
            const el = contentRef.current;
            if (!el) return;
            // Measure with shift cleared so each pass starts from the
            // trigger-centered position rather than the previous offset.
            el.style.setProperty('--tooltip-shift-x', '0px');
            const rect = el.getBoundingClientRect();
            const viewportWidth = document.documentElement.clientWidth;
            const overflowLeft = Math.max(0, VIEWPORT_PADDING_PX - rect.left);
            const overflowRight = Math.max(
                0,
                rect.right - (viewportWidth - VIEWPORT_PADDING_PX)
            );
            // Bias left: a left-edge overflow always wins, shifting right
            // so the leading text becomes visible. When only the right
            // edge overflows, shift left just enough to clear it, but
            // never further than the available room on the left — that
            // way the tooltip's start stays on-screen even when the
            // tooltip is wider than the viewport.
            let nextShift = 0;
            if (overflowLeft > 0) {
                nextShift = overflowLeft;
            } else if (overflowRight > 0) {
                const maxShiftLeft = Math.max(0, rect.left - VIEWPORT_PADDING_PX);
                nextShift = -Math.min(overflowRight, maxShiftLeft);
            }
            // Write the final shift to the DOM imperatively, then sync
            // React state. The imperative write matters: if `nextShift`
            // equals the current `shiftX` state, `setShiftX` bails out
            // without re-rendering, so React's inline-style branch (which
            // only emits the property when `shiftX !== 0`) would otherwise
            // leave the DOM stuck at the `0px` reset above.
            el.style.setProperty('--tooltip-shift-x', `${nextShift}px`);
            setShiftX(nextShift);
        }

        updateShift();
        window.addEventListener('resize', updateShift);
        return () => window.removeEventListener('resize', updateShift);
    }, [isVisible, content]);

    const contentStyle =
        shiftX !== 0
            ? ({ ['--tooltip-shift-x']: `${shiftX}px` } as CSSProperties)
            : undefined;

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
                    ref={contentRef}
                    role="tooltip"
                    className={`${styles.content} ${placement === 'bottom' ? styles.content_bottom : ''}`}
                    style={contentStyle}
                >
                    {content}
                    <span className={`${styles.arrow} ${placement === 'bottom' ? styles.arrow_bottom : ''}`} />
                </span>
            )}
        </span>
    );
}
