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
 * Theme toggle component that cycles through all available themes from backend.
 *
 * Fetches theme list from `/api/system/themes`, persists selection via cookies,
 * and dynamically renders Lucide icons based on theme configuration. When clicked,
 * cycles to the next available theme and updates the `data-theme` attribute on the
 * document root element.
 *
 * @returns {JSX.Element} A toggle button displaying the current theme's icon
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
                const fetchedThemes: ITheme[] = data.themes || [];
                setThemes(fetchedThemes);

                // Load saved theme preference from cookie
                const savedThemeId = getCookie('theme');
                const savedTheme = fetchedThemes.find(t => t.id === savedThemeId);

                if (savedTheme) {
                    setCurrentThemeId(savedTheme.id);
                    applyTheme(savedTheme.id);
                } else if (fetchedThemes.length > 0) {
                    // Default to first theme if no preference saved
                    const defaultTheme = fetchedThemes[0];
                    setCurrentThemeId(defaultTheme.id);
                    applyTheme(defaultTheme.id);
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
     * Cycle to next available theme.
     * Wraps around to first theme after reaching the last one.
     */
    function cycleTheme(): void {
        if (themes.length === 0) return;

        const currentIndex = themes.findIndex(t => t.id === currentThemeId);
        const nextIndex = (currentIndex + 1) % themes.length;
        const nextTheme = themes[nextIndex];

        setCurrentThemeId(nextTheme.id);
        setCookie('theme', nextTheme.id);
        applyTheme(nextTheme.id);
    }

    // Get current theme object
    const currentTheme = themes.find(t => t.id === currentThemeId);

    // Dynamically load Lucide icon component
    const IconComponent = currentTheme
        ? (LucideIcons as any)[currentTheme.icon]
        : null;

    // Avoid hydration mismatch by not rendering until mounted
    if (!mounted || !currentTheme || !IconComponent) {
        return null;
    }

    return (
        <button
            onClick={cycleTheme}
            className={styles.toggle}
            aria-label={`Current theme: ${currentTheme.name}. Click to cycle themes.`}
            title={`Current theme: ${currentTheme.name}`}
        >
            <IconComponent className={styles.icon} />
        </button>
    );
}
