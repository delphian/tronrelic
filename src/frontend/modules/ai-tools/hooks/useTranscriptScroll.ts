'use client';

/**
 * @file useTranscriptScroll.ts
 *
 * Scroll behaviour for a streaming chat transcript. Two things have to hold at
 * once: text arriving at the bottom stays in view for a reader who is at the
 * bottom, and a reader who scrolled up to re-read an earlier turn is never
 * yanked back down by the next token. The hook tracks which of the two the
 * reader is, exposes whether the live edge is in view (for a "jump to latest"
 * button), and offers the two programmatic scrolls the chat needs — to the
 * bottom, and to a chosen turn's top edge.
 *
 * Anchoring a turn to the top of the pane only works when there is at least a
 * pane's height of content below that turn's top edge. When the content is
 * shorter, the hook makes up the difference with a spacer element the caller
 * renders as the last child of the scrolling element, and keeps it exactly as
 * tall as needed: as the answer streams in, the spacer shrinks by the same
 * amount, so the anchored turn stays put, and once the content fills the pane
 * the spacer is gone. A fixed-height reserve would leave permanent empty space
 * at the bottom of every conversation, and would sit between the answer and
 * anything rendered after it, such as an inline composer.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';

/**
 * How close to the bottom (px) counts as "at the live edge". Wide enough that a
 * reader who nudged the wheel by accident is still followed, narrow enough that
 * someone reading two screens up is left alone.
 */
const AT_BOTTOM_THRESHOLD_PX = 120;

/** What the hook returns. */
export interface ITranscriptScroll {
    /** Whether the reader is within the threshold of the bottom. Drives the "Latest" button. */
    atBottom: boolean;
    /**
     * Whether new content should pull the view to the bottom. Held in a ref so
     * a streaming chunk can consult it without re-rendering. True after a send
     * or a jump to latest; false once the reader scrolls away.
     */
    followRef: MutableRefObject<boolean>;
    /** Scroll to the live edge and resume following. */
    scrollToBottom: () => void;
    /**
     * Scroll so the given element's top edge sits at the top of the pane, and
     * keep it reachable there through {@link fitReserve} until it leaves the
     * transcript.
     */
    anchorToTop: (element: HTMLElement) => void;
    /** Re-run the follow rule: scroll to the bottom only while following. */
    followIfEnabled: () => void;
    /**
     * Attach to an empty element rendered as the last child of the scrolling
     * element. The hook sets its height; the caller only places it.
     */
    reserveRef: RefObject<HTMLDivElement>;
    /**
     * Resize the spacer for the content as it is now. Call after anything that
     * changes the content's height — a streamed chunk, a new turn, the composer
     * growing — so the anchored turn neither drifts nor leaves extra space.
     */
    fitReserve: () => void;
}

/**
 * Manage auto-follow and the live-edge indicator for a scrolling transcript.
 *
 * The scroll listener cannot tell a user's wheel from a programmatic scroll, so
 * a scroll the hook performs itself sets a one-shot flag the next scroll event
 * consumes. The flag is set only when the position really moved, because that
 * is exactly when the browser fires the event that clears it. Programmatic
 * scrolls are instant rather than smooth for the same reason: a smooth scroll
 * fires many events, and the flag can only excuse one.
 *
 * @param ref - The scrolling transcript element.
 * @returns The follow state and the scroll actions.
 */
export function useTranscriptScroll(ref: RefObject<HTMLDivElement | null>): ITranscriptScroll {
    const [atBottom, setAtBottom] = useState(true);
    const followRef = useRef(true);
    /** Set by a programmatic scroll that moved, so its event is not read as user intent. */
    const programmaticRef = useRef(false);
    /** The spacer the caller renders last inside the scrolling element. */
    const reserveRef = useRef<HTMLDivElement>(null);
    /** The turn most recently anchored to the top, which the spacer keeps reachable. */
    const anchorTargetRef = useRef<HTMLElement | null>(null);

    /**
     * Set the spacer to the height that lets the anchored turn reach the top of
     * the pane, and to zero when nothing needs it — no anchored turn, or one
     * that has since left the transcript because a different conversation or a
     * new chat replaced it.
     *
     * The required total height is the anchored turn's distance from the top
     * plus one pane. The content ends where the spacer begins, so the spacer's
     * own `offsetTop` gives the content height directly; `scrollHeight` cannot
     * be used for that, because it never reports less than the pane's height.
     */
    const fitReserve = useCallback((): void => {
        const element = ref.current;
        const reserve = reserveRef.current;
        const target = anchorTargetRef.current;
        if (element && reserve) {
            let height = 0;
            if (target && target.isConnected && element.contains(target)) {
                const computed = getComputedStyle(element);
                const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
                const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
                const needed = target.offsetTop - paddingTop + element.clientHeight;
                const contentEnd = reserve.offsetTop + paddingBottom;
                height = Math.max(0, Math.ceil(needed - contentEnd));
            }
            reserve.style.height = `${height}px`;
        }
    }, [ref]);

    // A pane that changes height (window resize, the editing strip opening
    // below it) needs a different spacer for the same content.
    useEffect(() => {
        const element = ref.current;
        let observer: ResizeObserver | null = null;
        if (element && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => fitReserve());
            observer.observe(element);
        }
        return () => observer?.disconnect();
    }, [ref, fitReserve]);

    /**
     * Distance in px between the reader's viewport and the live edge, or zero
     * when the element is not mounted.
     */
    const distanceFromBottom = useCallback((): number => {
        const element = ref.current;
        if (!element) {
            return 0;
        }
        return element.scrollHeight - element.scrollTop - element.clientHeight;
    }, [ref]);

    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return undefined;
        }
        /**
         * Classify each scroll. A programmatic one only refreshes the live-edge
         * flag. A user's scroll away from the bottom stops following; a user's
         * scroll back to the bottom resumes it, so the "Latest" button is not
         * the only way back.
         */
        const handleScroll = (): void => {
            const near = distanceFromBottom() < AT_BOTTOM_THRESHOLD_PX;
            setAtBottom(near);
            if (programmaticRef.current) {
                programmaticRef.current = false;
                return;
            }
            followRef.current = near;
        };
        element.addEventListener('scroll', handleScroll, { passive: true });
        return () => element.removeEventListener('scroll', handleScroll);
    }, [ref, distanceFromBottom]);

    const scrollToBottom = useCallback((): void => {
        const element = ref.current;
        if (!element) {
            return;
        }
        followRef.current = true;
        // Claim the one-shot flag only when the position actually moves. The
        // browser fires a scroll event on a change and not otherwise, so
        // assigning the value scrollTop already holds — a transcript shorter
        // than the pane, or a chunk that added no height — would leave the flag
        // set for the reader's next real scroll to be swallowed by, and
        // following would stay on after the reader had scrolled away. Reading
        // scrollTop back is exact here because the transcript sets
        // scroll-behavior: auto, so the assignment settles before the next line.
        const before = element.scrollTop;
        element.scrollTop = element.scrollHeight;
        programmaticRef.current = element.scrollTop !== before;
        setAtBottom(true);
    }, [ref]);

    const anchorToTop = useCallback((target: HTMLElement): void => {
        const element = ref.current;
        if (!element) {
            return;
        }
        // Size the spacer before scrolling, or a turn near the end of a short
        // transcript could not be scrolled to the top at all.
        anchorTargetRef.current = target;
        fitReserve();
        // offsetTop is measured from the transcript's padding edge, which is the
        // transcript's offsetParent because the stylesheet positions it.
        const paddingTop = Number.parseFloat(getComputedStyle(element).paddingTop) || 0;
        // Same rule as scrollToBottom: anchoring a turn that already sits at the
        // top of the pane moves nothing and fires no scroll event, so the flag
        // must not be left set for the reader's next scroll to be swallowed by.
        const before = element.scrollTop;
        element.scrollTop = Math.max(0, target.offsetTop - paddingTop);
        programmaticRef.current = element.scrollTop !== before;
        followRef.current = distanceFromBottom() < AT_BOTTOM_THRESHOLD_PX;
        setAtBottom(followRef.current);
    }, [ref, distanceFromBottom, fitReserve]);

    const followIfEnabled = useCallback((): void => {
        if (followRef.current) {
            scrollToBottom();
        }
    }, [scrollToBottom]);

    return { atBottom, followRef, scrollToBottom, anchorToTop, followIfEnabled, reserveRef, fitReserve };
}
