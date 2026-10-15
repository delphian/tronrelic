'use client';

/**
 * @fileoverview Links to the current page in its other published languages.
 *
 * The switcher lists only the languages the page actually exists in, so a
 * visitor is never sent to a `/zh/...` address that would 404. It works the
 * list out from the public snapshot the root layout seeded and the path in the
 * address bar, which keeps it correct after client-side navigation without a
 * request of its own. On a page that exists only in English it renders
 * nothing.
 *
 * Each entry is a plain anchor rather than a Next.js `Link`. Changing language
 * changes the `[lang]` segment at the top of the route, and a full page load
 * is what guarantees the `<html lang>` attribute, the catalog, and the
 * surrounding navigation all switch together.
 *
 * @module modules/localization/components/LanguageSwitcher
 */

import type { ReactElement } from 'react';
import { usePathname } from 'next/navigation';
import { Languages } from 'lucide-react';
import { DEFAULT_LANGUAGE, findPublishedLanguages, localizePath, resolveLocalizedPath } from '@/types';
import { useLocalization } from '../../hooks/useLocalization';
import styles from './LanguageSwitcher.module.scss';

/** The default language is never in the snapshot, so its labels live here. */
const DEFAULT_LANGUAGE_LABELS = { name: 'English', nativeName: 'English' };

/** Props for {@link LanguageSwitcher}. */
interface ILanguageSwitcherProps {
    /** Show each language by its own name or by its short code. */
    display?: 'native' | 'code';
}

/**
 * Render the language links for the current page.
 *
 * @param props - Label style.
 * @returns A navigation list of language links, or null when the page exists only in English.
 */
export function LanguageSwitcher({ display = 'native' }: ILanguageSwitcherProps) {
    const { language, config } = useLocalization();
    const pathname = usePathname() ?? '/';
    const { path } = resolveLocalizedPath(pathname, config);
    const published = findPublishedLanguages(config, path);

    let content: ReactElement | null = null;
    if (published.length > 0) {
        const options = [
            { code: DEFAULT_LANGUAGE, ...DEFAULT_LANGUAGE_LABELS },
            ...config.languages.filter(entry => published.includes(entry.code))
        ];
        content = (
            <nav className={styles.switcher} aria-label="Language">
                <Languages size={16} aria-hidden="true" className={styles.icon} />
                <ul className={styles.list}>
                    {options.map(option => {
                        const isCurrent = option.code === language;
                        return (
                            <li key={option.code}>
                                <a
                                    href={localizePath(path, option.code)}
                                    hrefLang={option.code}
                                    lang={option.code}
                                    title={option.name}
                                    aria-current={isCurrent ? 'page' : undefined}
                                    className={isCurrent ? `${styles.link} ${styles.link_current}` : styles.link}
                                >
                                    {display === 'code' ? option.code.toUpperCase() : option.nativeName}
                                </a>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        );
    }

    return content;
}
