'use client';

/**
 * @fileoverview Contextual tooltip overlay.
 *
 * The overlay renders in a `<body>` portal with viewport-fixed coordinates.
 * It used to be a `position: absolute` child of its trigger, which left it at
 * the mercy of whatever hosted the trigger: any ancestor with `overflow` clipped
 * it, and any ancestor forming a stacking context (a `z-index`, a `transform`, a
 * `filter`) trapped its `z-index` inside that context, so a neighbouring card,
 * sticky header, or dialog painted straight over it. A portal removes it from
 * that tree entirely — the same fix `TronAddress` uses for its tools menu and
 * `AddressSelector` for its suggestion dropdown.
 *
 * Escaping the tree means giving up the CSS centering the overlay got for free,
 * so this component now measures the trigger and places the overlay itself:
 * centered on the trigger, clamped inside the viewport, on the preferred side
 * when it fits, flipped to the other side when it does not, and sent to
 * whichever side has more room when neither can hold it.
 */

import {
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent,
    type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

/**
 * Minimum gap between the tooltip and the viewport edges. Picks up just enough
 * breathing room so the tooltip never visually butts against a window border
 * but stays close to the trigger when one edge is tight.
 */
const VIEWPORT_PADDING_PX = 8;

/**
 * Gap between the trigger and the tooltip body. Matches the margin the overlay
 * carried when it was positioned in CSS, and leaves room for the 6px arrow that
 * sits in the gap pointing back at the trigger.
 */
const TRIGGER_GAP_PX = 12;

/**
 * Minimum distance from a tooltip corner to the arrow. Keeps the arrow off the
 * rounded corners when the tooltip has been clamped hard against a viewport
 * edge and the trigger sits near its end — without it the arrow detaches from
 * the tooltip's outline and reads as a stray triangle.
 */
const ARROW_INSET_PX = 12;

/**
 * Resolved viewport-fixed geometry for the portaled overlay. Held in state
 * rather than derived during render because measuring requires the DOM; `null`
 * means "not yet measured", which keeps the overlay invisible instead of
 * flashing wherever an unpositioned fixed element happens to land.
 */
interface ITooltipPosition {
    /** Distance from the viewport top, already flipped to the fitting side and clamped inside the viewport. */
    top: number;

    /** Distance from the viewport left, already clamped inside the viewport. */
    left: number;

    /** Arrow offset from the tooltip's own left edge, so it points at the trigger. */
    arrowX: number;

    /** Whether the overlay ended up below the trigger, which flips the arrow. */
    below: boolean;
}

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
    /** Preferred placement relative to the trigger; flipped when it will not fit (default: 'top') */
    placement?: 'top' | 'bottom';
}

/**
 * Constrain a value to a range, why: both the tooltip's horizontal position and
 * its arrow offset are "put it here unless that leaves the box", and expressing
 * that as one named helper keeps the placement maths readable instead of
 * nesting `Math.min` inside `Math.max` at every site.
 *
 * @param value - The ideal position before any edge is taken into account.
 * @param min - Lower bound the caller must not cross (a viewport or corner inset).
 * @param max - Upper bound the caller must not cross.
 * @returns The value moved inside the range, or the range's start when the
 *          range is inverted — which happens when the tooltip is wider than the
 *          space available, and biasing to the start keeps its leading text on
 *          screen rather than its trailing end.
 */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
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
 * `placement` states a preference, not a guarantee: the overlay flips to the
 * opposite side when the preferred one has no room, and falls back to whichever
 * side has more room when neither can hold it. Callers that previously
 * passed `placement="bottom"` purely to dodge clipping in a scrolling container
 * no longer need to — the portal removes that failure mode — but the prop is
 * still the right way to say which side reads better.
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
    const [position, setPosition] = useState<ITooltipPosition | null>(null);
    const triggerRef = useRef<HTMLSpanElement | null>(null);
    const contentRef = useRef<HTMLSpanElement | null>(null);
    // Explicit id linking trigger to overlay. The overlay used to sit directly
    // after the trigger in the DOM, which was the only thing relating the two;
    // the portal moves it under <body>, so the relationship has to be stated
    // rather than implied by adjacency.
    const tooltipId = useId();

    /**
     * Show the tooltip when a mouse pointer enters the trigger. Gated on
     * `pointerType` so a touch device — which synthesizes an enter event on tap
     * — does not open the tooltip through this path and then immediately
     * toggle it shut through the click handler.
     *
     * @param event - Pointer event carrying the `pointerType` that decides
     *        whether this is genuine hover or a synthesized touch event.
     */
    function handlePointerEnter(event: PointerEvent<HTMLSpanElement>) {
        if (event.pointerType === 'mouse') {
            setIsVisible(true);
        }
    }

    /**
     * Hide the tooltip when a mouse pointer leaves the trigger, gated on
     * `pointerType` for the same reason as {@link handlePointerEnter}: on touch
     * the tooltip is dismissed by an outside tap, not by pointer departure.
     *
     * @param event - Pointer event carrying the originating `pointerType`.
     */
    function handlePointerLeave(event: PointerEvent<HTMLSpanElement>) {
        if (event.pointerType === 'mouse') {
            setIsVisible(false);
        }
    }

    /**
     * Toggle visibility on tap, which is what gives touch users any way at all
     * to reach tooltip text — there is no hover to rely on.
     */
    function handleClick() {
        setIsVisible(prev => !prev);
    }

    // Close on outside tap so a touch user can dismiss without finding a
    // second tap target on the trigger itself. Listener is attached only
    // while the tooltip is open, so it is a no-op for hover-driven sessions.
    // The portaled overlay needs no test of its own here: it is
    // `pointer-events: none`, so it can never be the event target.
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

    /**
     * Place the portaled overlay against its trigger, why: the portal is what
     * stops the tooltip being clipped or painted over, but a fixed element does
     * not follow its anchor the way an absolutely-positioned child did. This
     * measures both boxes and resolves the placement — preferred side when it
     * fits, opposite side when it does not, horizontally centered on the trigger
     * and clamped inside the viewport, with the arrow offset back toward the
     * trigger so it still points at what the tooltip describes.
     *
     * Runs as a layout effect so the coordinates land before the browser paints;
     * measuring after paint would show the tooltip at the wrong place first.
     * Re-runs on `content` and `placement` because both change the box being
     * measured, and re-measures on resize and on captured scroll — captured so
     * that scrolling an inner container moves the tooltip too, not just
     * scrolling the window.
     */
    useLayoutEffect(() => {
        if (!isVisible) {
            setPosition(null);
            return undefined;
        }

        function updatePosition(): void {
            const trigger = triggerRef.current;
            const el = contentRef.current;
            if (!trigger || !el) return;
            const triggerRect = trigger.getBoundingClientRect();
            const tipRect = el.getBoundingClientRect();
            const viewportWidth = document.documentElement.clientWidth;
            const viewportHeight = document.documentElement.clientHeight;

            // Vertical side. Each test asks whether the whole tooltip plus its
            // gap clears the viewport edge, so a tooltip on a first table row
            // flips down instead of being placed off the top of the window —
            // where, being fixed, nothing could scroll it back into view.
            const fitsAbove =
                triggerRect.top - tipRect.height - TRIGGER_GAP_PX >= VIEWPORT_PADDING_PX;
            const fitsBelow =
                triggerRect.bottom + tipRect.height + TRIGGER_GAP_PX
                    <= viewportHeight - VIEWPORT_PADDING_PX;
            // Neither side fitting is not a tie. The clamp below pins the
            // overlay against whichever viewport edge it was sent toward, so
            // sending it to the roomier side is what keeps it reaching least far
            // back across the trigger it describes — and keeps the arrow, which
            // points to the side `below` claims, as honest as it can be.
            const roomierSideIsBelow =
                viewportHeight - triggerRect.bottom > triggerRect.top;
            const below = fitsAbove && fitsBelow
                ? placement === 'bottom'
                : (fitsBelow || (!fitsAbove && roomierSideIsBelow));
            // Clamped on the vertical axis for the same reason as the horizontal
            // one: when neither side has room — a tall tooltip in a short
            // viewport — the chosen side would otherwise leave a fixed element
            // partly off-screen, where no scroll can bring it back. `clamp`
            // biases to the top edge when the tooltip is taller than the
            // viewport, keeping its opening lines readable.
            const top = clamp(
                below
                    ? triggerRect.bottom + TRIGGER_GAP_PX
                    : triggerRect.top - tipRect.height - TRIGGER_GAP_PX,
                VIEWPORT_PADDING_PX,
                viewportHeight - tipRect.height - VIEWPORT_PADDING_PX
            );

            // Horizontal placement: centered on the trigger, then pulled back
            // inside the viewport. `clamp` biases to the left edge when the
            // tooltip is wider than the room available, keeping its leading
            // text readable rather than its trailing end.
            const triggerCenter = triggerRect.left + triggerRect.width / 2;
            const left = clamp(
                triggerCenter - tipRect.width / 2,
                VIEWPORT_PADDING_PX,
                viewportWidth - tipRect.width - VIEWPORT_PADDING_PX
            );

            // The arrow stays with the trigger rather than with the tooltip's
            // centre, so a clamped tooltip still visibly belongs to the element
            // it describes.
            const arrowX = clamp(
                triggerCenter - left,
                ARROW_INSET_PX,
                tipRect.width - ARROW_INSET_PX
            );

            setPosition({ top, left, arrowX, below });
        }

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isVisible, content, placement]);

    // Hidden until measured so the first paint never shows the overlay at the
    // static position an unpositioned fixed element falls back to.
    const contentStyle: CSSProperties = position
        ? {
            top: position.top,
            left: position.left,
            ['--tooltip-arrow-x' as string]: `${position.arrowX}px`
        }
        : { top: 0, left: 0, visibility: 'hidden' };

    return (
        <span
            ref={triggerRef}
            className={styles.trigger}
            aria-describedby={isVisible ? tooltipId : undefined}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            onClick={handleClick}
        >
            {children}
            {isVisible && createPortal(
                <span
                    ref={contentRef}
                    id={tooltipId}
                    role="tooltip"
                    className={`${styles.content} ${position?.below ? styles.content_bottom : ''}`}
                    style={contentStyle}
                >
                    {content}
                    <span
                        className={`${styles.arrow} ${position?.below ? styles.arrow_bottom : ''}`}
                    />
                </span>,
                document.body
            )}
        </span>
    );
}
