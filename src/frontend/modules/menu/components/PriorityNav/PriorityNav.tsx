/**
 * PriorityNav Component
 *
 * Implements the Priority+ navigation pattern: shows as many navigation items
 * as fit in the available width and moves the rest into a "More" dropdown.
 * Adapts to its container's width without fixed breakpoints, in both
 * directions — items move into "More" as the container narrows and come back
 * out as it widens again.
 *
 * Key features:
 * - Measurement-based overflow detection driven by a ResizeObserver
 * - Measures each item at its narrowest unclipped width, so host CSS that
 *   stretches items to fill the row does not change which items fit
 * - "More" dropdown for overflow items with item count
 * - Optional collapseAtCount to prevent orphan items
 * - Accessible keyboard navigation
 *
 * @example
 * ```tsx
 * <PriorityNav
 *     items={menuItems}
 *     collapseAtCount={2}
 *     renderItem={(item) => <Link href={item.url}>{item.label}</Link>}
 * />
 * ```
 */
'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks';
import styles from './PriorityNav.module.scss';

/**
 * How far, in pixels, the items may exceed the available width and still
 * count as fitting. Widths are fractional, so without this allowance an item
 * that fits exactly can be pushed into "More" by a rounding difference.
 */
const FIT_TOLERANCE_PX = 1;

/**
 * Props for individual menu items.
 */
export interface IPriorityNavItem {
    /**
     * Unique identifier for this item.
     */
    id: string;

    /**
     * React node to render for this item.
     */
    node: React.ReactNode;
}

/**
 * Props for PriorityNav component.
 */
export interface IPriorityNavProps {
    /**
     * Array of menu items to render.
     */
    items: IPriorityNavItem[];

    /**
     * Whether overflow handling is enabled.
     * When false, all items are always visible (may overflow container).
     * @default true
     */
    enabled?: boolean;

    /**
     * Minimum visible items before collapsing all to overflow.
     * Prevents awkward states like 1 item + "More" button.
     * Undefined means never collapse all.
     */
    collapseAtCount?: number;

    /**
     * Optional CSS class to apply to the root container.
     */
    className?: string;

    /**
     * Accessible label for the overflow toggle button.
     * @default "More menu items"
     */
    moreButtonLabel?: string;

    /**
     * Callback fired after the first overflow measurement has rendered.
     * Use this to coordinate fade-in timing with parent components.
     */
    onInitialized?: () => void;
}

/**
 * Raw widths read from the DOM during one measurement pass.
 */
interface IOverflowMeasurement {
    /**
     * Narrowest unclipped width of each item, in display order.
     */
    itemWidths: number[];

    /**
     * Gap the primary row places between neighbouring items.
     */
    itemGap: number;

    /**
     * Width of the container's content box, which the items and the
     * "More" button share.
     */
    availableWidth: number;

    /**
     * Width the "More" button takes when shown, including the gap that
     * separates it from the primary row.
     */
    moreButtonSpace: number;
}

/**
 * Works out how many leading items stay visible.
 *
 * Kept separate from the DOM reads so the fitting rule can be read on its
 * own. When every item fits in the full width, all of them stay and no
 * "More" button is needed. Otherwise the button will be shown, so the items
 * have to fit in what is left beside it, and they are taken in order until
 * the next one would not fit.
 *
 * @param measurement - Widths read from the DOM in one measurement pass
 * @returns The number of items, counted from the start, that remain visible
 */
function countFittingItems(measurement: IOverflowMeasurement): number {
    const { itemWidths, itemGap, availableWidth, moreButtonSpace } = measurement;
    const totalWidth = itemWidths.reduce((sum, width) => sum + width, 0)
        + itemGap * Math.max(itemWidths.length - 1, 0);

    let fitCount = itemWidths.length;

    if (totalWidth > availableWidth + FIT_TOLERANCE_PX) {
        const roomBesideMoreButton = availableWidth - moreButtonSpace;
        let usedWidth = 0;
        fitCount = 0;

        for (const width of itemWidths) {
            const widthWithItem = usedWidth + (fitCount > 0 ? itemGap : 0) + width;
            if (widthWithItem > roomBesideMoreButton + FIT_TOLERANCE_PX) {
                break;
            }
            usedWidth = widthWithItem;
            fitCount += 1;
        }
    }

    return fitCount;
}

/**
 * Reports whether two sets of item ids hold the same members.
 *
 * Measurement runs after every render, so it must leave state untouched when
 * nothing changed. Returning the previous set in that case lets React skip
 * the re-render instead of looping.
 *
 * @param first - The overflow ids currently in state
 * @param second - The overflow ids from the latest measurement
 * @returns True when both sets contain exactly the same ids
 */
function haveSameIds(first: Set<string>, second: Set<string>): boolean {
    let same = first.size === second.size;
    if (same) {
        for (const id of first) {
            if (!second.has(id)) {
                same = false;
                break;
            }
        }
    }
    return same;
}

/**
 * Priority+ navigation component with automatic overflow handling.
 *
 * Measures every item's narrowest unclipped width and the space available,
 * then moves the items that do not fit into a "More" dropdown. Measurement
 * runs after every render and whenever the container is resized, so the
 * split stays correct as the container narrows and as it widens again.
 */
export function PriorityNav({
    items,
    enabled = true,
    collapseAtCount,
    className = '',
    moreButtonLabel = 'More menu items',
    onInitialized
}: IPriorityNavProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const primaryRef = useRef<HTMLDivElement>(null);
    const hasCalledOnInitializedRef = useRef(false);

    const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isMounted, setIsMounted] = useState(false);
    const [hasMeasured, setHasMeasured] = useState(false);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const moreButtonRef = useRef<HTMLButtonElement>(null);

    /**
     * Track mount state so the dropdown portal only renders in the browser,
     * where `document.body` exists.
     */
    useEffect(() => {
        setIsMounted(true);
    }, []);

    /**
     * Call onInitialized after the first measurement has rendered.
     *
     * This effect runs after the render that includes the measured
     * overflowIds, so the DOM already shows the correct split when the
     * parent starts its fade-in.
     */
    useEffect(() => {
        if (hasMeasured && !hasCalledOnInitializedRef.current) {
            hasCalledOnInitializedRef.current = true;
            onInitialized?.();
        }
    }, [hasMeasured, onInitialized]);

    /**
     * Close dropdown and return focus to More button.
     */
    const closeDropdown = useCallback(() => {
        setIsDropdownOpen(false);
        moreButtonRef.current?.focus();
    }, []);

    /**
     * Close the dropdown when the user presses Escape, so keyboard users can
     * leave it without tabbing through every item.
     */
    useEffect(() => {
        /**
         * Close the open dropdown on Escape.
         *
         * @param event - The keydown event from the document
         */
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isDropdownOpen) {
                closeDropdown();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isDropdownOpen, closeDropdown]);

    /**
     * Close the dropdown when the user clicks anywhere outside it, which is
     * what people expect from a popup menu.
     */
    useEffect(() => {
        /**
         * Close the open dropdown when a click lands outside both the
         * dropdown and the button that opened it.
         *
         * @param event - The mousedown event from the document
         */
        const handleClickOutside = (event: MouseEvent) => {
            if (
                isDropdownOpen &&
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                !moreButtonRef.current?.contains(event.target as Node)
            ) {
                closeDropdown();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDropdownOpen, closeDropdown]);

    // Lock body scroll when dropdown is open on mobile
    useBodyScrollLock(isDropdownOpen);

    /**
     * Measure the items and update which of them overflow.
     *
     * Hidden items are taken out of the row, and host CSS may stretch the
     * visible ones, so neither shows its real minimum width as currently laid
     * out. The measurement therefore adds the `measuring` class, which puts
     * every item back in the row at its narrowest unclipped width and shows
     * the "More" button. It reads the widths and removes the class in the
     * same synchronous step, so the browser never paints that state.
     *
     * The available width is read before the class is added, so it reflects
     * the container as the user actually sees it.
     *
     * Items are read from the DOM in display order rather than from the
     * `items` prop, so this callback never goes stale and needs no
     * dependencies.
     */
    const measureOverflow = useCallback(() => {
        const container = containerRef.current;
        const primary = primaryRef.current;

        if (container && primary) {
            const containerStyle = getComputedStyle(container);
            const availableWidth = container.clientWidth
                - parseFloat(containerStyle.paddingLeft)
                - parseFloat(containerStyle.paddingRight);

            container.classList.add(styles.measuring);
            const itemElements = Array.from(
                primary.querySelectorAll<HTMLElement>(':scope > [data-priority-nav-id]')
            );
            const measurement: IOverflowMeasurement = {
                itemWidths: itemElements.map((element) => element.getBoundingClientRect().width),
                itemGap: parseFloat(getComputedStyle(primary).columnGap) || 0,
                availableWidth,
                moreButtonSpace: (moreButtonRef.current?.getBoundingClientRect().width ?? 0)
                    + (parseFloat(containerStyle.columnGap) || 0)
            };
            container.classList.remove(styles.measuring);

            const fitCount = countFittingItems(measurement);
            const nextOverflowIds = new Set(
                itemElements
                    .slice(fitCount)
                    .map((element) => element.getAttribute('data-priority-nav-id') ?? '')
            );

            setOverflowIds((previous) => (haveSameIds(previous, nextOverflowIds) ? previous : nextOverflowIds));
            setHasMeasured(true);
        }
    }, []);

    /**
     * Re-measure after every render.
     *
     * A render can change item widths without the container changing size,
     * for example when the item list, a translated label, or the active
     * item's styling changes. Running before paint keeps the user from
     * seeing an unmeasured frame, and measureOverflow leaves state untouched
     * when nothing changed, so this does not loop.
     */
    useLayoutEffect(() => {
        if (enabled) {
            measureOverflow();
        } else {
            setOverflowIds((previous) => (previous.size === 0 ? previous : new Set()));
        }
    });

    /**
     * Re-measure whenever the container is resized.
     *
     * The callback commits the new split with flushSync, so the change is
     * applied before the browser paints the resized frame. Without it, items
     * would show clipped at the edge for a frame while the user drags the
     * window narrower.
     */
    useLayoutEffect(() => {
        const container = containerRef.current;
        let resizeObserver: ResizeObserver | null = null;

        if (enabled && container) {
            resizeObserver = new ResizeObserver(() => {
                flushSync(measureOverflow);
            });
            resizeObserver.observe(container);
        }

        return () => resizeObserver?.disconnect();
    }, [enabled, measureOverflow]);

    /**
     * Calculate which items should be visible vs in overflow.
     */
    const visibleItems: IPriorityNavItem[] = [];
    const overflowItems: IPriorityNavItem[] = [];

    items.forEach((item) => {
        if (overflowIds.has(item.id)) {
            overflowItems.push(item);
        } else {
            visibleItems.push(item);
        }
    });

    // Apply collapseAtCount logic: if visible items fall below threshold,
    // move everything to overflow
    const shouldCollapseAll = collapseAtCount !== undefined &&
        visibleItems.length > 0 &&
        visibleItems.length < collapseAtCount &&
        overflowItems.length > 0;

    const finalOverflowItems = shouldCollapseAll ? items : overflowItems;

    const hasOverflow = finalOverflowItems.length > 0;

    /**
     * Close the dropdown once the measured overflow empties.
     *
     * A container that widens hands every item back to the primary row while
     * the dropdown is open, which removes both the "More" button and the
     * portal. An open flag left set after that keeps the mobile body scroll
     * lock applied with nothing on screen to dismiss, and reopens the
     * dropdown by itself as soon as the container narrows again. Clearing the
     * flag here releases the lock, because useBodyScrollLock only restores
     * the body's overflow when its argument changes. Focus is deliberately
     * not moved to the "More" button as closeDropdown would do, since that
     * button is display:none whenever there is no overflow.
     */
    useEffect(() => {
        if (isDropdownOpen && !hasOverflow) {
            setIsDropdownOpen(false);
        }
    }, [isDropdownOpen, hasOverflow]);

    return (
        <div
            ref={containerRef}
            className={`${styles.container} ${className}`}
        >
            {/* Primary navigation items */}
            <div ref={primaryRef} className={styles.primary}>
                {items.map((item) => (
                    <div
                        key={item.id}
                        data-priority-nav-id={item.id}
                        className={`${styles.item} ${overflowIds.has(item.id) || shouldCollapseAll ? styles.item_hidden : ''}`}
                    >
                        {item.node}
                    </div>
                ))}
            </div>

            {/* More button - only visible when there are overflow items. The
                count badge is always rendered so the measuring pass sees the
                button at the width it will have once it appears. */}
            {enabled && (
                <button
                    ref={moreButtonRef}
                    className={`${styles.more_button} ${hasOverflow ? styles.more_button_visible : ''}`}
                    onClick={() => setIsDropdownOpen((prev) => !prev)}
                    aria-label={moreButtonLabel}
                    aria-expanded={isDropdownOpen}
                    aria-haspopup="true"
                >
                    <MoreHorizontal size={20} />
                    <span className={styles.more_count}>
                        {finalOverflowItems.length}
                    </span>
                </button>
            )}

            {/* Dropdown portal */}
            {isMounted && isDropdownOpen && hasOverflow && createPortal(
                <>
                    {/* Backdrop - prevents interaction with page behind sheet */}
                    <div
                        className={styles.backdrop}
                        aria-hidden="true"
                        onClick={closeDropdown}
                        onTouchMove={(e) => e.preventDefault()}
                    />

                    {/* Dropdown panel (bottom sheet on mobile) */}
                    {/* TODO: Consider using floating-ui for more robust positioning
                        that handles edge cases like dropdowns near screen edges.
                        Current manual getBoundingClientRect works but doesn't
                        auto-flip when near viewport boundaries. */}
                    <div
                        ref={dropdownRef}
                        className={styles.dropdown}
                        role="menu"
                        aria-label="Additional menu items"
                        style={{
                            top: moreButtonRef.current
                                ? moreButtonRef.current.getBoundingClientRect().bottom + 8
                                : 0,
                            right: moreButtonRef.current
                                ? window.innerWidth - moreButtonRef.current.getBoundingClientRect().right
                                : 0
                        }}
                    >
                        {/* Drag handle - visible on mobile bottom sheet */}
                        <div className={styles.drag_handle} aria-hidden="true" />

                        <button
                            className={styles.close_button}
                            onClick={closeDropdown}
                            aria-label="Close menu"
                        >
                            <X size={20} />
                        </button>

                        <nav className={styles.dropdown_items}>
                            {finalOverflowItems.map((item) => (
                                <div
                                    key={item.id}
                                    className={styles.dropdown_item}
                                    role="menuitem"
                                    onClick={closeDropdown}
                                >
                                    {item.node}
                                </div>
                            ))}
                        </nav>
                    </div>
                </>,
                document.body
            )}
        </div>
    );
}
