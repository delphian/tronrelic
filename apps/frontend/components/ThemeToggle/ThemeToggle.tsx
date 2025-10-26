'use client';

import { useState, useEffect } from 'react';
import { Ghost } from 'lucide-react';
import styles from './ThemeToggle.module.css';

/**
 * Theme toggle component for switching between default and Halloween themes.
 *
 * Manages theme persistence via localStorage and applies theme by setting
 * the data-theme attribute on the document root element. The Halloween theme
 * is defined in semantic-tokens.css with orange/purple color overrides.
 *
 * @returns {JSX.Element} A toggle button that switches between themes
 */
export function ThemeToggle() {
    const [theme, setTheme] = useState<'default' | 'halloween'>('default');
    const [mounted, setMounted] = useState(false);

    // Load saved theme preference on mount
    useEffect(() => {
        setMounted(true);
        const savedTheme = localStorage.getItem('theme') as 'default' | 'halloween' | null;
        if (savedTheme) {
            setTheme(savedTheme);
            document.documentElement.setAttribute('data-theme', savedTheme);
        }
    }, []);

    /**
     * Toggle between default and Halloween themes.
     * Persists preference to localStorage and updates document attribute.
     */
    const toggleTheme = () => {
        const newTheme = theme === 'default' ? 'halloween' : 'default';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    };

    // Avoid hydration mismatch by not rendering until mounted
    if (!mounted) {
        return null;
    }

    return (
        <button
            onClick={toggleTheme}
            className={styles.toggle}
            aria-label={theme === 'default' ? 'Enable Halloween theme' : 'Disable Halloween theme'}
            title={theme === 'default' ? 'Enable Halloween theme' : 'Disable Halloween theme'}
        >
            <Ghost className={styles.icon} />
            {theme === 'halloween' && <span className={styles.activeIndicator} />}
        </button>
    );
}
