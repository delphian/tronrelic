/**
 * @fileoverview Clipboard-write hook shared by every copy affordance.
 *
 * Copying a value is one behaviour with two presentations — a labelled
 * `<CopyButton>` and an icon-only `<TrCopyIcon>` — and the behaviour is the
 * fiddly part: a clipboard API that is absent outside secure contexts, a
 * confirmation window that must not outlive the component, and a click that
 * must not reach a clickable ancestor row. Keeping that in one hook means a
 * copy affordance added later inherits the fallback and the cleanup instead of
 * re-deriving them, and a fix lands once.
 */
'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';

/** How long the confirmation state persists before reverting, in ms. */
const DEFAULT_RESET_MS = 1500;

/**
 * What {@link useCopyToClipboard} hands back to a copy affordance.
 */
export interface IUseCopyToClipboard {
    /** True during the confirmation window after a successful copy. */
    copied: boolean;
    /** Click handler to place on the affordance's button. */
    copy: (event: MouseEvent<HTMLButtonElement>) => Promise<void>;
}

/**
 * Write a value to the system clipboard on click and expose a short-lived
 * confirmation flag the caller renders as a checkmark or a "Copied" label.
 *
 * Falls back to a hidden-textarea `execCommand` path because the async
 * clipboard API is unavailable on older browsers and on any non-secure origin
 * (plain-HTTP staging hosts included) — without the fallback the affordance
 * silently does nothing there. The confirmation timer is cleared on unmount so
 * a row that disappears mid-window cannot set state on a dead component.
 *
 * @param value - String placed on the clipboard; the caller's address, hash, or
 *        connection string.
 * @param resetMs - How long the confirmation lasts before reverting. Callers
 *        raise it when the affordance sits somewhere easy to look away from.
 * @returns The confirmation flag and the click handler to wire up.
 */
export function useCopyToClipboard(
    value: string,
    resetMs: number = DEFAULT_RESET_MS
): IUseCopyToClipboard {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }, []);

    const copy = useCallback(async (event: MouseEvent<HTMLButtonElement>): Promise<void> => {
        // Copy affordances routinely sit inside clickable rows; letting the
        // click bubble would navigate away from the value just copied.
        event.stopPropagation();
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = value;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'absolute';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            setCopied(true);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => setCopied(false), resetMs);
        } catch {
            // A rejected clipboard write (denied permission, no fallback path)
            // must not leave a confirmation the user cannot trust.
            setCopied(false);
        }
    }, [value, resetMs]);

    return { copied, copy };
}
