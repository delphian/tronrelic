'use client';

/**
 * @file useViewportFill.ts
 *
 * Measures where an element sits in the document so a stylesheet can size it
 * to the rest of the viewport. A chat pane wants to end at the bottom of the
 * screen, but how far from the top it starts depends on everything rendered
 * above it — the site header, a widget zone, a pending-approval badge, a tab
 * row — none of which the pane's own CSS can see. Handing the measured offset
 * to CSS as a custom property lets the height be `100dvh - offset` and stay
 * correct as the page above it changes.
 */

import { useEffect, useState, type RefObject } from 'react';

/**
 * Report an element's document-relative top edge in pixels, re-measured
 * whenever the layout above it may have moved: on mount, on window resize,
 * whenever the document body changes size (a badge appearing, a tab switching),
 * and whenever the caller says the element became visible.
 *
 * Returns null until the first measurement, and keeps the last good value while
 * the element is hidden (a `display: none` ancestor reports a zero-size box,
 * which is not a position). Reading a stale value while hidden is harmless
 * because nothing is painted; re-measuring on `active` fixes it up as soon as
 * the element shows again.
 *
 * @param ref - The element to measure.
 * @param active - Whether the element is currently shown. A change to true
 *   forces a re-measure, because a hidden element cannot be measured.
 * @returns The element's top edge relative to the document, in px, or null.
 */
export function useViewportFill(ref: RefObject<HTMLElement | null>, active: boolean): number | null {
    const [top, setTop] = useState<number | null>(null);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        /**
         * Read the element's position and publish it. Skips a hidden element,
         * whose bounding box is all zeros and would size the pane to the whole
         * viewport.
         */
        const measure = (): void => {
            const element = ref.current;
            if (!element) {
                return;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                return;
            }
            setTop(Math.round(rect.top + window.scrollY));
        };
        measure();
        window.addEventListener('resize', measure);
        // The body grows or shrinks whenever something above the element is
        // added or removed, which is exactly when the offset changes.
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        observer?.observe(document.body);
        return () => {
            window.removeEventListener('resize', measure);
            observer?.disconnect();
        };
    }, [ref, active]);

    return top;
}
