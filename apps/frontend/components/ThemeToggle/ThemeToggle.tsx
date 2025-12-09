'use client';

import { useState, createElement } from 'react';
import type { IOrderedTheme } from '../../app/layout';
import styles from './ThemeToggle.module.css';

/**
 * SVG element definition matching lucide package format.
 * Each tuple contains [elementType, attributes].
 */
type IconElement = [string, Record<string, string>];

/**
 * Array of SVG elements that compose an icon.
 */
type IconNode = IconElement[];

/**
 * Set cookie with 1 year expiration.
 *
 * @param name - Cookie name
 * @param value - Cookie value
 */
function setCookie(name: string, value: string): void {
    if (typeof document === 'undefined') return;
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    document.cookie = `${name}=${value}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

/**
 * Delete cookie by name.
 *
 * @param name - Cookie name
 */
function deleteCookie(name: string): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
}

/**
 * Inject theme CSS into document head if not already present.
 *
 * Lazy-loads theme CSS on first use to improve initial page load performance.
 * Only the selected theme's CSS is injected during SSR; other themes are
 * injected here when the user clicks a theme button.
 *
 * @param themeId - Theme UUID
 * @param themeName - Theme display name
 * @param css - Theme CSS content
 */
function injectThemeCSS(themeId: string, themeName: string, css: string): void {
    if (typeof document === 'undefined') return;

    // Check if already injected
    if (document.querySelector(`style[data-theme-id="${themeId}"]`)) {
        return;
    }

    // Create and inject style element
    const style = document.createElement('style');
    style.setAttribute('data-theme-id', themeId);
    style.setAttribute('data-theme-name', themeName);
    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * Render an icon from pre-resolved SVG path data.
 *
 * Uses createElement to build SVG elements from the lucide icon node format.
 * This avoids importing lucide-react and its ~562KB bundle.
 *
 * @param iconNode - Array of [elementType, attributes] tuples
 * @param className - CSS class for the SVG element
 * @returns SVG element or null if no valid icon data
 */
function renderIcon(iconNode: IconNode | null, className: string): JSX.Element | null {
    if (!iconNode || iconNode.length === 0) {
        return null;
    }

    // Build SVG children from icon node data
    const children = iconNode.map((element, index) => {
        const [tag, attrs] = element;
        return createElement(tag, { key: index, ...attrs });
    });

    // Wrap in SVG with standard lucide attributes
    return createElement(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            width: 24,
            height: 24,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            className
        },
        children
    );
}

/**
 * Props for the ThemeToggle component.
 */
interface ThemeToggleProps {
    /**
     * Active themes passed from server component for SSR rendering.
     * When provided, the component renders immediately without fetching.
     */
    initialThemes: IOrderedTheme[];
    /**
     * Currently selected theme ID from cookie, read during SSR.
     * After hydration, client state takes over for theme switching.
     */
    initialThemeId: string | null;
}

/**
 * Theme toggle component that displays one button per active theme.
 *
 * SSR + Live Updates Pattern:
 * - Receives theme data from server component for immediate rendering (no loading flash)
 * - Renders icons using pre-resolved SVG data from the backend
 * - After hydration, handles theme switching interactively via client state
 *
 * This eliminates the need to bundle all ~1,867 Lucide icons (~562KB) on every page
 * and ensures theme toggle buttons are visible immediately on page load.
 *
 * When a theme button is clicked, it toggles that theme on/off. If toggled on, all other
 * themes are automatically disabled. The `data-theme` attribute is removed when no theme
 * is active.
 *
 * @param props - Component props including SSR theme data
 * @returns One toggle button per active theme
 */
export function ThemeToggle({ initialThemes, initialThemeId }: ThemeToggleProps) {
    // SSR + Live Updates: Initialize state from server-provided props
    const [themes] = useState<IOrderedTheme[]>(initialThemes);
    const [currentThemeId, setCurrentThemeId] = useState<string | null>(initialThemeId);

    /**
     * Apply theme by setting data-theme attribute on document root.
     *
     * @param themeId - Theme UUID to apply
     */
    function applyTheme(themeId: string): void {
        if (typeof document === 'undefined') return;
        document.documentElement.setAttribute('data-theme', themeId);
    }

    /**
     * Remove data-theme attribute from document root.
     */
    function removeTheme(): void {
        if (typeof document === 'undefined') return;
        document.documentElement.removeAttribute('data-theme');
    }

    /**
     * Toggle a specific theme on/off.
     * If toggling on, disables all other themes.
     * If toggling off, removes data-theme attribute.
     *
     * Lazy-injects theme CSS on first use for improved initial page load.
     *
     * @param themeId - Theme UUID to toggle
     */
    function toggleTheme(themeId: string): void {
        if (currentThemeId === themeId) {
            // Toggle off - remove theme
            setCurrentThemeId(null);
            deleteCookie('theme');
            removeTheme();
        } else {
            // Toggle on - inject CSS if needed, then apply theme
            const theme = themes.find(t => t.id === themeId);
            if (theme) {
                injectThemeCSS(theme.id, theme.name, theme.css);
            }
            setCurrentThemeId(themeId);
            setCookie('theme', themeId);
            applyTheme(themeId);
        }
    }

    // No themes available - render nothing
    if (themes.length === 0) {
        return null;
    }

    return (
        <>
            {themes.map((theme) => {
                const icon = renderIcon(theme.iconSvg, styles.icon);
                const isActive = currentThemeId === theme.id;

                // Skip if icon is invalid
                if (!icon) {
                    return null;
                }

                return (
                    <button
                        key={theme.id}
                        onClick={() => toggleTheme(theme.id)}
                        className={styles.toggle}
                        aria-label={`Theme: ${theme.name}. ${isActive ? 'Currently active. Click to disable.' : 'Click to enable.'}`}
                        title={`${theme.name}${isActive ? ' (Active)' : ''}`}
                    >
                        {icon}
                        {isActive && <span className={styles.active_indicator} />}
                    </button>
                );
            })}
        </>
    );
}
