/**
 * HamburgerMenu Component
 *
 * Responsive navigation menu that collapses into a hamburger icon when the container
 * width falls below a configured threshold. Uses CSS container queries (not media
 * queries) to enable context-aware responsive behavior based on available space
 * rather than viewport size.
 *
 * The component provides a sliding panel interface with backdrop overlay, accessible
 * keyboard navigation, and focus management. Menu items can be any React content,
 * allowing flexibility for different navigation structures.
 *
 * @example
 * ```tsx
 * <HamburgerMenu
 *     triggerWidth={768}
 *     items={[
 *         <Link href="/" key="home">Home</Link>,
 *         <Link href="/about" key="about">About</Link>
 *     ]}
 * />
 * ```
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';
import styles from './HamburgerMenu.module.css';

/**
 * Props for HamburgerMenu component.
 */
export interface IHamburgerMenuProps {
    /**
     * Container width in pixels that triggers hamburger mode.
     *
     * When the component's container is narrower than this width, the menu
     * collapses into a hamburger icon. Uses CSS container queries.
     */
    triggerWidth: number;

    /**
     * Menu items to render in the slideout panel.
     *
     * Can be any React nodes - typically navigation links, but supports
     * arbitrary content like search forms, user profiles, etc.
     */
    items: React.ReactNode[];

    /**
     * Content to display in normal (wide) mode.
     *
     * When container is wider than triggerWidth, this content is shown
     * instead of the hamburger button. Typically the full navigation links.
     */
    children: React.ReactNode;

    /**
     * Optional CSS class to apply to the root container.
     */
    className?: string;

    /**
     * Optional aria-label for the hamburger button.
     * @default "Toggle navigation menu"
     */
    ariaLabel?: string;
}

/**
 * Responsive hamburger navigation menu with slideout panel.
 *
 * Provides a collapsible menu that appears as a hamburger icon when container
 * width is constrained. Clicking the icon opens a full-height slideout panel
 * with backdrop overlay. The panel slides in from the right and includes a
 * close button for dismissal.
 *
 * Key features:
 * - Container query-based responsiveness (adapts to parent, not viewport)
 * - Accessible keyboard navigation (Escape to close, focus management)
 * - Click-outside-to-close behavior
 * - Smooth slide-in/out animations
 * - Backdrop overlay to focus attention and enable click-to-close
 *
 * The component uses CSS container queries to automatically show/hide based on
 * the triggerWidth prop. Because CSS variables cannot be used in container query
 * conditions, we inject the literal breakpoint value via an inline style tag.
 *
 * @param props - Component configuration
 * @param props.triggerWidth - Pixel width that triggers hamburger mode
 * @param props.items - Menu items to display in slideout
 * @param props.children - Content to display in normal (wide) mode
 * @param props.className - Optional CSS class for root element
 * @param props.ariaLabel - Optional accessible label for toggle button
 */
export function HamburgerMenu({
    triggerWidth,
    items,
    children,
    className = '',
    ariaLabel = 'Toggle navigation menu'
}: IHamburgerMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    /**
     * Generate unique instance ID for this component.
     *
     * Each HamburgerMenu instance needs a unique container name so that
     * the injected container query styles don't conflict across multiple
     * instances with different trigger widths.
     */
    const instanceId = useRef(`hm-${Math.random().toString(36).substr(2, 9)}`).current;

    /**
     * Closes the menu panel.
     *
     * Called when user clicks close button, clicks outside, or presses Escape.
     * Returns focus to the hamburger button for keyboard navigation continuity.
     */
    const closeMenu = () => {
        setIsOpen(false);
        // Return focus to hamburger button after closing
        buttonRef.current?.focus();
    };

    /**
     * Toggles menu panel open/closed state.
     *
     * Called when user clicks the hamburger button.
     */
    const toggleMenu = () => {
        setIsOpen(prev => !prev);
    };

    /**
     * Handles Escape key press to close menu.
     *
     * Provides accessible keyboard navigation allowing users to dismiss the
     * menu without reaching for the mouse.
     */
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen) {
                closeMenu();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen]);

    /**
     * Handles clicks outside the panel to close menu.
     *
     * Improves UX by allowing users to dismiss the menu by clicking the
     * backdrop overlay anywhere outside the panel.
     */
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                isOpen &&
                panelRef.current &&
                !panelRef.current.contains(event.target as Node) &&
                !buttonRef.current?.contains(event.target as Node)
            ) {
                closeMenu();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    /**
     * Prevents body scroll when menu is open.
     *
     * Improves mobile UX by preventing background content from scrolling
     * when the menu panel is visible.
     */
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    return (
        <>
            {/*
              * Injected container query with literal breakpoint value.
              *
              * CSS variables (var()) cannot be used in container query conditions,
              * so we inject the literal triggerWidth value via this style tag.
              * Each instance gets a unique container name to prevent conflicts.
              *
              * This approach keeps all styling in the CSS Module except for the
              * dynamic breakpoint, which must be injected as literal CSS.
              */}
            <style>{`
                @container ${instanceId} (max-width: ${triggerWidth}px) {
                    .hamburger_button_${instanceId} {
                        display: inline-flex;
                    }
                    .normal_content_${instanceId} {
                        display: none;
                    }
                }
            `}</style>

            <div
                className={`${styles.container} ${className}`}
                style={
                    {
                        containerType: 'inline-size',
                        containerName: instanceId
                    } as React.CSSProperties
                }
            >
                {/* Hamburger button - only visible when container is narrow */}
                <button
                    ref={buttonRef}
                    className={`${styles.hamburger_button} hamburger_button_${instanceId}`}
                    onClick={toggleMenu}
                    aria-label={ariaLabel}
                    aria-expanded={isOpen}
                    aria-controls="hamburger-menu-panel"
                >
                    <Menu size={24} />
                </button>

                {/* Normal navigation content - hidden when hamburger is visible */}
                <div className={`${styles.normal_content} normal_content_${instanceId}`}>
                    {children}
                </div>

                {/* Backdrop overlay - only visible when menu is open */}
                {isOpen && (
                    <div className={styles.backdrop} aria-hidden="true" />
                )}

                {/* Slideout panel */}
                <div
                    ref={panelRef}
                    id="hamburger-menu-panel"
                    className={`${styles.panel} ${isOpen ? styles.panel_open : ''}`}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Navigation menu"
                >
                    {/* Close button */}
                    <button
                        className={styles.close_button}
                        onClick={closeMenu}
                        aria-label="Close menu"
                    >
                        <X size={24} />
                    </button>

                    {/* Menu items */}
                    <nav className={styles.menu_items}>
                        {items.map((item, index) => (
                            <div key={index} className={styles.menu_item} onClick={closeMenu}>
                                {item}
                            </div>
                        ))}
                    </nav>
                </div>
            </div>
        </>
    );
}
