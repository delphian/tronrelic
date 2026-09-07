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
    /** Scroll so the given element's top edge sits at the top of the pane. */
    anchorToTop: (element: HTMLElement) => void;
    /** Re-run the follow rule: scroll to the bottom only while following. */
    followIfEnabled: () => void;
}

/**
 * Manage auto-follow and the live-edge indicator for a scrolling transcript.
 *
 * The scroll listener cannot tell a user's wheel from a programmatic scroll, so
 * every scroll the hook performs itself sets a one-shot flag the next scroll
 * event consumes. Programmatic scrolls are instant rather than smooth for the
 * same reason: a smooth scroll fires many events, and the flag can only excuse
 * one.
 *
 * @param ref - The scrolling transcript element.
 * @returns The follow state and the scroll actions.
 */
export function useTranscriptScroll(ref: RefObject<HTMLDivElement | null>): ITranscriptScroll {
    const [atBottom, setAtBottom] = useState(true);
    const followRef = useRef(true);
    /** Set before a programmatic scroll so its scroll event is not read as user intent. */
    const programmaticRef = useRef(false);

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
        programmaticRef.current = true;
        element.scrollTop = element.scrollHeight;
        setAtBottom(true);
    }, [ref]);

    const anchorToTop = useCallback((target: HTMLElement): void => {
        const element = ref.current;
        if (!element) {
            return;
        }
        // offsetTop is measured from the transcript's padding edge, which is the
        // transcript's offsetParent because the stylesheet positions it.
        const paddingTop = Number.parseFloat(getComputedStyle(element).paddingTop) || 0;
        programmaticRef.current = true;
        element.scrollTop = Math.max(0, target.offsetTop - paddingTop);
        followRef.current = distanceFromBottom() < AT_BOTTOM_THRESHOLD_PX;
        setAtBottom(followRef.current);
    }, [ref, distanceFromBottom]);

    const followIfEnabled = useCallback((): void => {
        if (followRef.current) {
            scrollToBottom();
        }
    }, [scrollToBottom]);

    return { atBottom, followRef, scrollToBottom, anchorToTop, followIfEnabled };
}
