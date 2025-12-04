/**
 * PriorityNav Component
 *
 * Implements Priority+ navigation pattern using IntersectionObserver.
 * Shows as many navigation items as fit, moving overflow items to a "More" dropdown.
 * Adapts automatically to container width without fixed breakpoints.
 *
 * Key features:
 * - IntersectionObserver-based overflow detection (no width calculations)
 * - Automatic adaptation to container size changes
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

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks';
import styles from './PriorityNav.module.css';

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
}

/**
 * Priority+ navigation component with automatic overflow handling.
 *
 * Uses IntersectionObserver to detect which items overflow the container
 * boundary and moves them to a "More" dropdown. This approach is more
 * efficient than width calculations and adapts to any container size.
 */
export function PriorityNav({
    items,
    enabled = true,
    collapseAtCount,
    className = '',
    moreButtonLabel = 'More menu items'
}: IPriorityNavProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isMounted, setIsMounted] = useState(false);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const moreButtonRef = useRef<HTMLButtonElement>(null);

    // Stable dependency for observer setup - only recreate when item IDs change
    const itemIds = useMemo(() => items.map(i => i.id).join(','), [items]);

    // Track mount state for portal rendering (SSR safety)
    useEffect(() => {
        setIsMounted(true);
    }, []);

    /**
     * Close dropdown and return focus to More button.
     */
    const closeDropdown = useCallback(() => {
        setIsDropdownOpen(false);
        moreButtonRef.current?.focus();
    }, []);

    /**
     * Handle Escape key to close dropdown.
     */
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isDropdownOpen) {
                closeDropdown();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isDropdownOpen, closeDropdown]);

    /**
     * Handle clicks outside dropdown to close it.
     */
    useEffect(() => {
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
     * Set up IntersectionObserver to detect overflow.
     */
    useEffect(() => {
        if (!enabled || !containerRef.current) {
            setOverflowIds(new Set());
            return;
        }

        const container = containerRef.current;

        // Create observer that detects when items leave the container boundary
        observerRef.current = new IntersectionObserver(
            (entries) => {
                setOverflowIds((prev) => {
                    const next = new Set(prev);

                    entries.forEach((entry) => {
                        const id = entry.target.getAttribute('data-priority-nav-id');
                        if (!id) return;

                        if (entry.isIntersecting && entry.intersectionRatio >= 0.99) {
                            // Item is fully visible, remove from overflow
                            next.delete(id);
                        } else {
                            // Item is clipped or hidden, add to overflow
                            next.add(id);
                        }
                    });

                    return next;
                });

            },
            {
                root: container,
                threshold: [0, 0.99, 1],
                rootMargin: '0px'
            }
        );

        // Observe all item elements
        itemRefs.current.forEach((element) => {
            observerRef.current?.observe(element);
        });

        return () => {
            observerRef.current?.disconnect();
        };
    }, [enabled, itemIds]);

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
     * Store ref for an item element and observe if observer exists.
     *
     * Handles dynamic item additions by observing new elements immediately
     * when they're added to the DOM, rather than waiting for effect re-run.
     */
    const setItemRef = useCallback((id: string, element: HTMLDivElement | null) => {
        if (element) {
            itemRefs.current.set(id, element);
            // Observe newly added elements immediately
            observerRef.current?.observe(element);
        } else {
            const existingElement = itemRefs.current.get(id);
            if (existingElement) {
                observerRef.current?.unobserve(existingElement);
            }
            itemRefs.current.delete(id);
        }
    }, []);

    return (
        <div
            ref={containerRef}
            className={`${styles.container} ${className}`}
        >
            {/* Primary navigation items */}
            <div className={styles.primary}>
                {items.map((item) => (
                    <div
                        key={item.id}
                        ref={(el) => setItemRef(item.id, el)}
                        data-priority-nav-id={item.id}
                        className={`${styles.item} ${overflowIds.has(item.id) || shouldCollapseAll ? styles.item_hidden : ''}`}
                    >
                        {item.node}
                    </div>
                ))}
            </div>

            {/* More button - only visible when there are overflow items */}
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
                    {hasOverflow && (
                        <span className={styles.more_count}>
                            {finalOverflowItems.length}
                        </span>
                    )}
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
