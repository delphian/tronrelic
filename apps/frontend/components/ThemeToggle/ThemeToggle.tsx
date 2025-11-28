'use client';

import { useState, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
import { getRuntimeConfig } from '../../lib/runtimeConfig';
import styles from './ThemeToggle.module.css';

/**
 * Theme metadata from backend.
 */
interface ITheme {
    id: string;
    name: string;
    icon: string;
    isActive: boolean;
}

/**
 * Get cookie value by name.
 *
 * @param name - Cookie name
 * @returns Cookie value or null if not found
 */
function getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
        const cookieValue = parts.pop()?.split(';').shift();
        return cookieValue || null;
    }
    return null;
}

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
 * Theme toggle component that displays one button per active theme.
 *
 * Fetches active themes from `/api/system/themes`, persists selection via cookies,
 * and dynamically renders Lucide icons based on theme configuration. When a theme
 * button is clicked, it toggles that theme on/off. If toggled on, all other themes
 * are automatically disabled. The `data-theme` attribute is removed when no theme
 * is active.
 *
 * @returns {JSX.Element} One toggle button per active theme
 */
export function ThemeToggle() {
    const [themes, setThemes] = useState<ITheme[]>([]);
    const [currentThemeId, setCurrentThemeId] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    // Fetch available themes on mount
    useEffect(() => {
        async function fetchThemes() {
            const config = getRuntimeConfig();

            try {
                const response = await fetch(`${config.apiUrl}/system/themes`);
                if (!response.ok) {
                    console.error('Failed to fetch themes:', response.status);
                    return;
                }

                const data = await response.json();
                const allThemes: ITheme[] = data.themes || [];
                // Only include active themes
                const activeThemes = allThemes.filter(t => t.isActive);
                setThemes(activeThemes);

                // Load saved theme preference from cookie
                const savedThemeId = getCookie('theme');
                const savedTheme = activeThemes.find(t => t.id === savedThemeId);

                if (savedTheme) {
                    setCurrentThemeId(savedTheme.id);
                    applyTheme(savedTheme.id);
                } else {
                    // No theme active by default
                    setCurrentThemeId(null);
                    removeTheme();
                }
            } catch (error) {
                console.error('Error fetching themes:', error);
            }
        }

        setMounted(true);
        void fetchThemes();
    }, []);

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
     * @param themeId - Theme UUID to toggle
     */
    function toggleTheme(themeId: string): void {
        if (currentThemeId === themeId) {
            // Toggle off - remove theme
            setCurrentThemeId(null);
            deleteCookie('theme');
            removeTheme();
        } else {
            // Toggle on - apply this theme and disable others
            setCurrentThemeId(themeId);
            setCookie('theme', themeId);
            applyTheme(themeId);
        }
    }

    // Avoid hydration mismatch by not rendering until mounted
    if (!mounted || themes.length === 0) {
        return null;
    }

    return (
        <>
            {themes.map((theme) => {
                const IconComponent = (LucideIcons as any)[theme.icon];
                const isActive = currentThemeId === theme.id;

                // Skip if icon is invalid
                if (!IconComponent) {
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
                        <IconComponent className={styles.icon} />
                        {isActive && <span className={styles.active_indicator} />}
                    </button>
                );
            })}
        </>
    );
}
