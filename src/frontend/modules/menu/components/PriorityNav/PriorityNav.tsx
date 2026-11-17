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
 * - Measurement-based overflow detection driven by a ResizeObserver that
 *   watches the container and every item, so an item that changes size
 *   after the first measurement, such as a tab whose icon loads late, is
 *   measured again
 * - Measures each item at its narrowest unclipped width, so host CSS that
 *   stretches items to fill the row does not change which items fit
 * - Keeps the active item (`activeId`) in the row when the row folds, in
 *   place of the last leading item that would otherwise fit
 * - "More" dropdown for overflow items with item count, drawn as active when
 *   the active item still ends up inside it
 * - Optional collapseAtCount to prevent orphan items
 * - Accessible keyboard navigation
 *
 * @example
 * ```tsx
 * <PriorityNav
 *     items={menuItems}
 *     activeId={currentItemId}
 *     collapseAtCount={2}
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

    /**
     * Id of the item for the page or tab being shown. When the row folds and
     * this item would land in "More", the component reserves its width and
     * shows it in place of the last leading item that fits, so the visitor
     * can still see which page or tab is selected. Omit it, or pass an id no
     * item has, and the leading items stay in order as before.
     */
    activeId?: string;

    /**
     * Plain-text label of the active item, shown on the "More" button when
     * the active item still ends up inside it, which happens when it is wider
     * than the room beside the button or when `collapseAtCount` folds every
     * item. Omit it to keep the button to its icon and count; the button is
     * still drawn as active.
     */
    activeLabel?: string;
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
     * Display position of the active item, or -1 when no item is active.
     */
    activeIndex: number;

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

    /**
     * The same width with the folded active item's label taken off, which is
     * the width the button has once that item is back in the row. The fitting
     * rule decides on this width so the split does not depend on resize
     * history: the label the button is carrying right now would otherwise
     * make the room beside it look smaller than it will actually be.
     */
    unlabelledMoreButtonSpace: number;
}

/**
 * Counts how many of the given items, taken in order from the first, fit in
 * a width, with the row's gap between neighbours.
 *
 * @param itemWidths - Widths of the candidate items, in display order
 * @param itemGap - Gap the row places between neighbouring items
 * @param room - Width the items have to fit in
 * @returns The number of leading items that fit
 */
function countLeadingItemsThatFit(itemWidths: number[], itemGap: number, room: number): number {
    let usedWidth = 0;
    let fitCount = 0;

    for (const width of itemWidths) {
        const widthWithItem = usedWidth + (fitCount > 0 ? itemGap : 0) + width;
        if (widthWithItem > room + FIT_TOLERANCE_PX) {
            break;
        }
        usedWidth = widthWithItem;
        fitCount += 1;
    }

    return fitCount;
}

/**
 * Works out which items stay visible.
 *
 * Kept separate from the DOM reads so the fitting rule can be read on its
 * own. When every item fits in the full width, all of them stay and no
 * "More" button is needed. Otherwise the button will be shown, so the items
 * have to fit in what is left beside it, and they are taken in order until
 * the next one would not fit.
 *
 * When that would put the active item in "More", its width is reserved
 * first and the leading items fill what is left, so the active item takes
 * the place of the last leading item that would otherwise fit. It keeps its
 * position in the display order, so it shows after the leading items. If the
 * active item is wider than the whole room beside the button, it cannot be
 * shown and the plain leading split is kept.
 *
 * Whether it fits is asked against the button's unlabelled width, because
 * the button only carries the active item's label while that item is folded.
 * Deciding on the labelled width would make folding self-reinforcing: the
 * label it adds widens the same button whose width the next pass reserves,
 * so the row would keep the item folded at a width that can display it. Only
 * once the item is known to stay folded is the wider labelled width reserved
 * for the leading split.
 *
 * @param measurement - Widths read from the DOM in one measurement pass
 * @returns The display positions of the items that remain visible
 */
function chooseVisibleItems(measurement: IOverflowMeasurement): Set<number> {
    const { itemWidths, activeIndex, itemGap, availableWidth, moreButtonSpace, unlabelledMoreButtonSpace } = measurement;
    const totalWidth = itemWidths.reduce((sum, width) => sum + width, 0)
        + itemGap * Math.max(itemWidths.length - 1, 0);

    let visibleCount = itemWidths.length;
    let keepActive = false;

    if (totalWidth > availableWidth + FIT_TOLERANCE_PX) {
        const roomBesideUnlabelledButton = availableWidth - unlabelledMoreButtonSpace;
        const leadingFitCount = countLeadingItemsThatFit(itemWidths, itemGap, roomBesideUnlabelledButton);
        const activeWidth = activeIndex >= 0 ? itemWidths[activeIndex] : undefined;

        if (activeWidth !== undefined && activeIndex >= leadingFitCount) {
            if (activeWidth <= roomBesideUnlabelledButton + FIT_TOLERANCE_PX) {
                keepActive = true;
                visibleCount = countLeadingItemsThatFit(
                    itemWidths.slice(0, activeIndex),
                    itemGap,
                    roomBesideUnlabelledButton - activeWidth - itemGap
                );
            } else {
                visibleCount = countLeadingItemsThatFit(itemWidths, itemGap, availableWidth - moreButtonSpace);
            }
        } else {
            visibleCount = leadingFitCount;
        }
    }

    const visible = new Set<number>();
    for (let index = 0; index < visibleCount; index += 1) {
        visible.add(index);
    }
    if (keepActive) {
        visible.add(activeIndex);
    }

    return visible;
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
 * then moves the items that do not fit into a "More" dropdown, keeping the
 * active item visible where it fits. Measurement runs after every render and
 * whenever the container or an item is resized, so the split stays correct
 * as the container narrows and widens and as items change size.
 */
export function PriorityNav({
    items,
    enabled = true,
    collapseAtCount,
    className = '',
    moreButtonLabel = 'More menu items',
    onInitialized,
    activeId,
    activeLabel
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
    const moreLabelRef = useRef<HTMLSpanElement>(null);

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
        /** Close the open dropdown on Escape. */
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
     * Items, and which of them is active, are read from the DOM in display
     * order rather than from the props, so this callback never goes stale and
     * needs no dependencies.
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
            const containerGap = parseFloat(containerStyle.columnGap) || 0;
            const moreButton = moreButtonRef.current;
            const moreButtonWidth = moreButton?.getBoundingClientRect().width ?? 0;
            // The button carries the active item's label only while that item
            // is folded, so the label and the gap before it come off the width
            // the fitting rule decides on.
            const moreLabelSpace = moreButton && moreLabelRef.current
                ? moreLabelRef.current.getBoundingClientRect().width
                    + (parseFloat(getComputedStyle(moreButton).columnGap) || 0)
                : 0;
            const measurement: IOverflowMeasurement = {
                itemWidths: itemElements.map((element) => element.getBoundingClientRect().width),
                activeIndex: itemElements.findIndex((element) => element.hasAttribute('data-priority-nav-active')),
                itemGap: parseFloat(getComputedStyle(primary).columnGap) || 0,
                availableWidth,
                moreButtonSpace: moreButtonWidth + containerGap,
                unlabelledMoreButtonSpace: moreButtonWidth - moreLabelSpace + containerGap
            };
            container.classList.remove(styles.measuring);

            const visibleIndexes = chooseVisibleItems(measurement);
            const nextOverflowIds = new Set(
                itemElements
                    .filter((_, index) => !visibleIndexes.has(index))
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

    // Changes whenever an item is added, removed, or reordered, so the
    // observer below starts watching the item wrappers React now renders.
    const itemIdsKey = items.map((item) => item.id).join('\n');

    /**
     * Re-measure whenever the container or one of the items is resized.
     *
     * Items are watched as well as the container because an item can change
     * width while the container does not. Menu icons, for example, load in a
     * separate chunk after the first measurement and only re-render the icon
     * itself, so without this the split taken before they arrived would
     * stand and the last visible item would be clipped.
     *
     * A container resize commits the new split with flushSync, so it is
     * applied before the browser paints the resized frame. Without it, items
     * would show clipped at the edge for a frame while the user drags the
     * window narrower. An item resize is committed on the next frame instead:
     * committing it inside the observer callback can resize sibling items
     * the observer has already reported in this frame, which the browser
     * reports as a ResizeObserver loop error.
     */
    useLayoutEffect(() => {
        const container = containerRef.current;
        const primary = primaryRef.current;
        let resizeObserver: ResizeObserver | null = null;

        if (enabled && container && primary) {
            /**
             * Re-measure after a resize, committing at once only when the
             * container itself changed size.
             *
             * @param entries - The watched elements whose size changed
             */
            const handleResize = (entries: ResizeObserverEntry[]) => {
                if (entries.some((entry) => entry.target === container)) {
                    flushSync(measureOverflow);
                } else {
                    measureOverflow();
                }
            };
            const observer = new ResizeObserver(handleResize);
            observer.observe(container);
            primary
                .querySelectorAll<HTMLElement>(':scope > [data-priority-nav-id]')
                .forEach((element) => observer.observe(element));
            resizeObserver = observer;
        }

        return () => resizeObserver?.disconnect();
    }, [enabled, measureOverflow, itemIdsKey]);

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

    // The active item can still end up in "More": when it is wider than the
    // room beside the button, or when collapseAtCount folds every item. The
    // button then stands in for it, drawn as active and, when the caller gave
    // a label, naming it, so the row still shows where the visitor is. The
    // accessible name leads with the label so it contains the visible text.
    const isActiveItemFolded = activeId !== undefined
        && finalOverflowItems.some((item) => item.id === activeId);
    const foldedActiveLabel = isActiveItemFolded && activeLabel ? activeLabel : undefined;
    const moreButtonAccessibleLabel = foldedActiveLabel
        ? `${foldedActiveLabel}, ${moreButtonLabel}`
        : moreButtonLabel;
    const moreButtonClassName = [
        styles.more_button,
        hasOverflow ? styles.more_button_visible : '',
        isActiveItemFolded ? styles.more_button_active : ''
    ].filter(Boolean).join(' ');

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
            {/* Primary navigation items. The active item is marked in the DOM
                so the measurement can find it without reading props. */}
            <div ref={primaryRef} className={styles.primary}>
                {items.map((item) => (
                    <div
                        key={item.id}
                        data-priority-nav-id={item.id}
                        data-priority-nav-active={item.id === activeId ? '' : undefined}
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
                    className={moreButtonClassName}
                    onClick={() => setIsDropdownOpen((prev) => !prev)}
                    aria-label={moreButtonAccessibleLabel}
                    aria-expanded={isDropdownOpen}
                    aria-haspopup="true"
                >
                    <MoreHorizontal size={20} />
                    {foldedActiveLabel && (
                        <span ref={moreLabelRef} className={styles.more_label}>{foldedActiveLabel}</span>
                    )}
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
