/**
 * useBodyScrollLock Hook
 *
 * Locks body scroll on mobile devices when a modal/sheet is open.
 * Prevents background page from scrolling while interacting with overlays.
 *
 * Uses overflow:hidden to prevent body scrolling. Does NOT set touch-action:none
 * because that would disable touch scrolling for all descendants, including
 * the overlay content itself. The overlay should use overscroll-behavior:contain
 * to prevent scroll chaining back to the body.
 *
 * Only activates on mobile viewports (≤768px).
 *
 * @example
 * ```tsx
 * // Lock scroll when dropdown is open
 * useBodyScrollLock(isDropdownOpen);
 *
 * // Lock scroll when category is expanded
 * useBodyScrollLock(!!expandedCategoryId);
 * ```
 */
import { useEffect } from 'react';

/**
 * Mobile breakpoint matching CSS media query.
 * Centralized to ensure consistency with CSS breakpoints.
 */
const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)';

/**
 * Locks body scroll when isLocked is true on mobile devices.
 *
 * @param isLocked - Whether to lock body scroll
 */
export function useBodyScrollLock(isLocked: boolean): void {
    useEffect(() => {
        if (!isLocked) return;

        const isMobile = window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
        if (!isMobile) return;

        const originalOverflow = document.body.style.overflow;

        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [isLocked]);
}
