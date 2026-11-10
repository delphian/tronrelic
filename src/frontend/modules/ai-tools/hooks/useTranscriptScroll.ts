'use client';

/**
 * @file useTranscriptScroll.ts
 *
 * Scroll behaviour for a streaming chat transcript that reads like a terminal:
 * new output builds up from the bottom, and the view stays pinned to the
 * bottom edge while the reader is there. Two things have to hold at once: text
 * arriving at the bottom stays in view for a reader who is at the bottom, and a
 * reader who scrolled up to re-read an earlier turn is never yanked back down
 * by the next token. The hook tracks which of the two the reader is, exposes
 * whether the live edge is in view (for a "jump to latest" button), and offers
 * the scroll to the bottom the chat needs after a send.
 *
 * There is deliberately no "scroll the sent message to the top" behaviour.
 * That needs empty space below a short answer so the message can reach the
 * top, and a terminal never shows empty space under its input line once the
 * screen has filled.
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
    /** Re-run the follow rule: scroll to the bottom only while following. */
    followIfEnabled: () => void;
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

    /**
     * Distance in px between the reader's viewport and the live edge, or zero
     * when the element is not mounted.
     */
    const distanceFromBottom = useCallback((): number => {
        const element = ref.current;
        let distance = 0;
        if (element) {
            distance = element.scrollHeight - element.scrollTop - element.clientHeight;
        }
        return distance;
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
            } else {
                followRef.current = near;
            }
        };
        element.addEventListener('scroll', handleScroll, { passive: true });
        return () => element.removeEventListener('scroll', handleScroll);
    }, [ref, distanceFromBottom]);

    /**
     * Jump to the live edge and resume following, for a send or the "Latest"
     * button. Claims the one-shot flag only when the position actually moves:
     * the browser fires a scroll event on a change and not otherwise, so
     * assigning the value scrollTop already holds — a transcript shorter than
     * the pane, or a chunk that added no height — would leave the flag set for
     * the reader's next real scroll to be swallowed by, and following would stay
     * on after the reader had scrolled away. Reading scrollTop back is exact
     * because the transcript sets scroll-behavior: auto, so the assignment
     * settles before the next line.
     */
    const scrollToBottom = useCallback((): void => {
        const element = ref.current;
        if (element) {
            followRef.current = true;
            const before = element.scrollTop;
            element.scrollTop = element.scrollHeight;
            programmaticRef.current = element.scrollTop !== before;
            setAtBottom(true);
        }
    }, [ref]);

    /**
     * After the transcript changes, scroll to the bottom only while the reader
     * is following, so a reader who scrolled up keeps their place.
     */
    const followIfEnabled = useCallback((): void => {
        if (followRef.current) {
            scrollToBottom();
        }
    }, [scrollToBottom]);

    return { atBottom, followRef, scrollToBottom, followIfEnabled };
}
