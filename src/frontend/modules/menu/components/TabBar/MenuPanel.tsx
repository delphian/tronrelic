'use client';

/**
 * @fileoverview The full menu the tab bar's Menu tab opens.
 *
 * A tab bar has room for four or five destinations, so everything else needs
 * a home one tap away. This panel lists a whole menu namespace with each
 * item's children indented beneath it, and ends with the language switcher,
 * which is where the large crypto data sites put language on a phone.
 *
 * It renders inside `SlideOver`, which already provides the portal, focus
 * handling, Escape to close, and the scroll lock a full-screen panel needs,
 * and fills the screen at phone width.
 *
 * @module modules/menu/components/TabBar/MenuPanel
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MenuNodeSerialized } from '@/shared';
import { SlideOver } from '../../../../components/ui/SlideOver';
import { useMenuTree } from '../../hooks/useMenuTree';
import { menuTranslationKey } from '../../lib/menuTranslationKey';
import { isMenuPathActive } from '../../lib/isMenuPathActive';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { useLocalizedHref } from '../../../localization/hooks/useLocalizedHref';
// Imported from the component folder rather than the localization barrel,
// which also exports the admin tabs and their stylesheets.
import { LanguageSwitcher } from '../../../localization/components/LanguageSwitcher';
import { MenuNodeIcon } from '../../../../components/layout/MenuNav/MenuNodeIcon';
import { cn } from '../../../../lib/cn';
import styles from './MenuPanel.module.scss';

/** Pixel size of the icon beside a top-level entry, the 16px heading step. */
const ENTRY_ICON_SIZE = 16;

/**
 * Deepest level of the tree the panel draws, counting the top level as 1.
 * The header menu draws three levels too, so nothing reachable there is lost
 * here, and the limit stops a malformed tree from indenting off the screen.
 */
const MAX_DEPTH = 3;

/**
 * Props for {@link MenuPanel}.
 */
interface IMenuPanelProps {
    /** Whether the panel is showing; the tab bar owns this state. */
    open: boolean;
    /** Closes the panel, called on the close button, Escape, the backdrop, or a link tap. */
    onClose: () => void;
    /** The panel heading, already translated by the tab bar. */
    title: string;
    /** The menu namespace to list. */
    namespace: string;
    /** Whether to end the panel with the language switcher. */
    languageSwitcher: boolean;
}

/**
 * Props for {@link MenuPanelEntries}.
 */
interface IMenuPanelEntriesProps {
    /** The items at this level of the tree. */
    items: MenuNodeSerialized[];
    /** How deep this level is, starting at 1 for the top level. */
    depth: number;
    /** The namespace the items belong to, which their translation keys include. */
    namespace: string;
    /** Closes the panel when a link is tapped, since the page is about to change. */
    onNavigate: () => void;
}

/**
 * Render one level of the menu tree as a list, recursing into children.
 *
 * An item with a URL is a link; one without is a group heading, because a
 * category with no page of its own still needs its name above its children.
 *
 * @param props - The items to draw, their depth, their namespace, and the close handler.
 * @returns A list of entries, or nothing when the level holds no enabled items.
 */
function MenuPanelEntries({ items, depth, namespace, onNavigate }: IMenuPanelEntriesProps) {
    const pathname = usePathname() ?? '/';
    const { t } = useTranslation();
    const localizeHref = useLocalizedHref();
    const visible = items.filter(item => item.enabled).sort((a, b) => a.order - b.order);

    return visible.length === 0 ? null : (
        <ul className={depth === 1 ? styles.list : styles.sublist}>
            {visible.map(item => {
                const label = t(menuTranslationKey(namespace, item), item.label);
                const href = item.url ? localizeHref(item.url) : undefined;
                const isActive = href !== undefined && isMenuPathActive(pathname, href, item.url === '/');
                const icon = depth === 1 && item.icon
                    ? <MenuNodeIcon name={item.icon} size={ENTRY_ICON_SIZE} />
                    : null;
                const children = item.children ?? [];
                return (
                    <li key={item._id} className={depth === 1 ? styles.root_entry : undefined}>
                        {href !== undefined ? (
                            <Link
                                href={href}
                                className={cn(styles.link, isActive && styles.link_active)}
                                aria-current={isActive ? 'page' : undefined}
                                onClick={onNavigate}
                            >
                                {icon}
                                <span>{label}</span>
                            </Link>
                        ) : (
                            <span className={styles.group_label}>{label}</span>
                        )}
                        {depth < MAX_DEPTH && children.length > 0 && (
                            <MenuPanelEntries items={children} depth={depth + 1} namespace={namespace} onNavigate={onNavigate} />
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * Render the full-menu panel.
 *
 * @param props - Open state, close handler, heading, namespace, and whether to show languages.
 * @returns The slide-over panel, which renders nothing while closed.
 */
export function MenuPanel({ open, onClose, title, namespace, languageSwitcher }: IMenuPanelProps) {
    const { roots } = useMenuTree(namespace);

    return (
        <SlideOver open={open} onClose={onClose} title={title} label={title}>
            <nav aria-label={title}>
                <MenuPanelEntries items={roots} depth={1} namespace={namespace} onNavigate={onClose} />
            </nav>
            {/* The switcher renders nothing on a page that exists only in
                English, which leaves this wrapper empty; :empty hides it. */}
            {languageSwitcher && (
                <div className={styles.languages}>
                    <LanguageSwitcher display="native" />
                </div>
            )}
        </SlideOver>
    );
}
