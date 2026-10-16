/**
 * Client-side navigation component for database-driven menus.
 *
 * This component handles interactive behavior (active state highlighting) while
 * receiving menu items as props from the server component. Uses CSS Module for
 * consistent theming across all navigation instances.
 *
 * The component is designed to work with server-rendered menu data, allowing
 * menu items to be dynamically managed through the IMenuService without requiring
 * client-side fetching or hardcoded navigation arrays.
 *
 * Responsive behavior uses the Priority+ navigation pattern (PriorityNav) to
 * automatically show as many items as fit, moving overflow items to a "More"
 * dropdown based on the namespace configuration from the backend.
 *
 * Admin items live as a subtree of `main` rooted at the System
 * container; there is no separate `system` namespace, so all callers
 * pass `namespace="main"` and rely on per-user `requiresAdmin` gating
 * to filter the rendered tree.
 *
 * By default each leaf renders as a navigating `<Link>` whose active state is
 * derived from the current pathname. Callers building an in-page submenu — a
 * tab row backed by its own menu namespace — opt into different behavior with
 * two additive props: `onItemSelect` intercepts leaf clicks so activation
 * drives local state (e.g. a `?tab=` query param) instead of route navigation,
 * and `activeUrl` overrides pathname-based highlighting because the route does
 * not change between tabs. Both default to undefined, leaving existing
 * navigation consumers untouched.
 *
 * Every label, and every accessible name built from one, renders through the
 * localization module's `t()`, so a menu on a translated page shows the labels
 * saved on `/system/localization`. Item labels are keyed by namespace and URL
 * (see `menuTranslationKey`), because an item a plugin registers without
 * saving it gets a new id on every backend restart. Links go through
 * `useLocalizedHref`, so on a translated page an item whose target is
 * published in the same language links to that language's address, and
 * active-item highlighting compares against that address.
 *
 * @example
 * ```tsx
 * <MenuNavClient
 *     namespace="main"
 *     items={menuItems}
 *     generatedAt={generatedAt}
 *     ariaLabel="Main navigation"
 * />
 * ```
 */
'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MenuNodeSerialized } from '@/shared';
import { PriorityNav, useMenuConfig, useBodyScrollLock } from '../../../modules/menu';
import { menuTreeSeeded } from '../../../modules/menu/slice';
import { menuTranslationKey } from '../../../modules/menu/lib/menuTranslationKey';
// Imported from the hook file rather than the localization barrel, which also
// exports components with stylesheets.
import { useTranslation } from '../../../modules/localization/hooks/useTranslation';
import { useLocalizedHref } from '../../../modules/localization/hooks/useLocalizedHref';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { MenuNodeIcon } from './MenuNodeIcon';
import styles from './MenuNav.module.scss';

type IconPosition = 'left' | 'right' | 'top';

/**
 * Props for MenuNavClient component.
 */
interface IMenuNavClientProps {
    /**
     * Menu namespace (e.g., 'main', 'footer'). Used to fetch
     * namespace-specific configuration. Admin items live in `main` under
     * the System container — there is no `system` namespace.
     */
    namespace: string;

    /**
     * Menu items fetched by the server component.
     *
     * Shape matches the Redux slice's storage type so the SSR baseline can
     * be dispatched into Redux verbatim. Once seeded, Redux drives every
     * render and this prop becomes a one-shot bootstrap input rather than
     * a competing source of truth.
     */
    items: MenuNodeSerialized[];

    /**
     * Timestamp of the SSR tree snapshot, recorded on the namespace state
     * as `lastUpdated` when seeding Redux on mount.
     */
    generatedAt: string;

    /**
     * Optional aria-label for the nav element.
     * Defaults to "{namespace} navigation".
     */
    ariaLabel?: string;

    /**
     * Optional activation handler for leaf items. When provided, clicking a
     * leaf link calls this callback and suppresses navigation (the handler
     * receives the already-default-prevented event), letting a caller drive
     * in-page tab state — for example syncing a `?tab=` query param — instead
     * of routing. Omitted (the default) preserves ordinary `<Link>`
     * navigation, so existing consumers are unaffected. Container (parent)
     * nodes are unaffected; only leaf links honor this.
     */
    onItemSelect?: (item: MenuNodeSerialized, event: ReactMouseEvent<HTMLAnchorElement>) => void;

    /**
     * Optional active-item override. When set, the leaf whose `url` equals this
     * value is highlighted instead of deriving active state from the current
     * pathname. Pair it with `onItemSelect` for in-page tab submenus where the
     * route is identical across tabs. Omitted (the default) keeps
     * pathname-based highlighting for navigation consumers.
     */
    activeUrl?: string;
}

/**
 * Client-side navigation component with active state highlighting.
 *
 * Receives menu items from server component and handles interactive behavior.
 * Uses Next.js usePathname hook to highlight the active tab based on current route.
 *
 * The component sorts items by order and filters out disabled items before rendering.
 * Active state uses startsWith matching to highlight tabs for nested routes
 * (e.g., /system/pages/edit shows "Pages" tab as active).
 *
 * Responsive behavior uses Priority+ navigation (PriorityNav) to measure
 * overflow and move items to a "More" dropdown based on available space and
 * the namespace configuration.
 *
 * @param props - Component props
 * @param props.namespace - Menu namespace for config lookup
 * @param props.items - Menu items from server
 * @param props.generatedAt - SSR snapshot timestamp seeded onto Redux
 * @param props.ariaLabel - Optional accessible label
 * @param props.onItemSelect - Optional leaf activation handler; suppresses navigation when set
 * @param props.activeUrl - Optional active-item override keyed by url; bypasses pathname matching
 */
export function MenuNavClient({ namespace, items, generatedAt, ariaLabel, onItemSelect, activeUrl }: IMenuNavClientProps) {
    const pathname = usePathname();
    const dispatch = useAppDispatch();
    const menuConfig = useMenuConfig(namespace);
    const { t } = useTranslation();
    const localizeHref = useLocalizedHref();
    const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
    // Tracks an open second-level submenu inside the currently expanded category
    // dropdown. Single-open invariant matches top-level categories. Initial null
    // is shared by server and first client render so this state never causes a
    // hydration mismatch — both render the dropdown closed.
    const [expandedSubcategoryId, setExpandedSubcategoryId] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);
    const [hasInitialized, setHasInitialized] = useState(false);
    const hasInitializedRef = useRef(false);
    const categoryButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Redux is the single source of truth for the rendered tree. The `items`
    // prop seeds it on first mount; thereafter SocketBridge dispatches
    // refetchMenuTree on `menu:update` and Redux drives every subsequent
    // render. The `?? items` fallback only matters during the first paint,
    // before the seed effect runs.
    const liveMenuState = useAppSelector(state => state.menu.namespaces[namespace]);
    const activeItems = liveMenuState?.roots ?? items;

    // Seed Redux from the SSR tree on mount when the namespace is empty.
    // Subsequent navigations that reuse a populated namespace skip the seed
    // so live state from earlier mutations isn't clobbered by stale SSR.
    useEffect(() => {
        if (!liveMenuState) {
            dispatch(menuTreeSeeded({ namespace, roots: items, timestamp: generatedAt }));
        }
        // We intentionally only seed once per mount when Redux is empty;
        // re-running on items/generatedAt churn would race with live updates.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [namespace, dispatch]);

    // Sort by order and filter enabled items
    const visibleItems = useMemo(() => activeItems
        .filter(item => item.enabled)
        .sort((a, b) => a.order - b.order), [activeItems]);

    // Whether overflow handling (Priority+ nav) is enabled for this namespace
    const overflowEnabled = menuConfig.overflow?.enabled ?? true;

    // Icon + label rendering controls. Defaults match `useMenuConfig`'s
    // DEFAULT_CONFIG so behavior is identical when the admin has not saved
    // a namespace config yet. If both icons and labels are disabled the
    // link would render empty, so labels win the fallback — operators can
    // still see and click the items they just hid.
    const iconsEnabled = menuConfig.icons?.enabled ?? true;
    const iconPosition: IconPosition = (menuConfig.icons?.position as IconPosition) ?? 'left';
    const showLabelsConfigured = menuConfig.styling?.showLabels ?? true;
    const isCompact = menuConfig.styling?.compact ?? false;
    // `MenuNodeIcon` uses `next/dynamic({ ssr: false })`, so the icon
    // glyph renders nothing during SSR, nothing during the first client
    // paint, and nothing for no-JS users. Keeping labels visible until
    // `isMounted` flips post-hydration guarantees every tab has visible
    // content in all three of those states. Once mounted, the configured
    // `showLabels` value takes over — and if the operator turned icons
    // off entirely we always keep labels visible as a last-resort
    // fallback (otherwise the tab has nothing to render).
    const showLabels = !iconsEnabled || !isMounted ? true : showLabelsConfigured;

    // Track mount state for portal rendering (SSR safety)
    useEffect(() => {
        setIsMounted(true);
    }, []);

    /**
     * Callback from PriorityNav once its first overflow measurement has rendered.
     * Triggers the fade-in transition by adding the initialized class.
     */
    const handlePriorityNavInitialized = useCallback(() => {
        if (!hasInitializedRef.current) {
            hasInitializedRef.current = true;
            setHasInitialized(true);
        }
    }, []);

    /**
     * Initialize immediately when overflow is disabled.
     *
     * When overflowEnabled is false, PriorityNav isn't rendered and won't fire
     * onInitialized. We must trigger fade-in manually to avoid invisible nav.
     */
    useEffect(() => {
        if (!overflowEnabled) {
            handlePriorityNavInitialized();
        }
    }, [overflowEnabled, handlePriorityNavInitialized]);

    /**
     * Close dropdown and return focus to the category button.
     */
    const closeDropdown = useCallback(() => {
        if (expandedCategoryId) {
            const button = categoryButtonRefs.current.get(expandedCategoryId);
            setExpandedCategoryId(null);
            // Reset nested submenu so reopening the parent never restores
            // a stale second-level expansion.
            setExpandedSubcategoryId(null);
            button?.focus();
        }
    }, [expandedCategoryId]);

    /**
     * Handle Escape key to close dropdown.
     */
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && expandedCategoryId) {
                closeDropdown();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [expandedCategoryId, closeDropdown]);

    /**
     * Handle clicks outside dropdown to close it.
     */
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!expandedCategoryId) return;

            const button = categoryButtonRefs.current.get(expandedCategoryId);
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                !button?.contains(event.target as Node)
            ) {
                closeDropdown();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [expandedCategoryId, closeDropdown]);

    // Lock body scroll when category dropdown is open on mobile
    useBodyScrollLock(!!expandedCategoryId);

    /**
     * Toggles a category's expanded state.
     *
     * Reopening or switching the top-level category also collapses any open
     * second-level submenu so the dropdown never restores stale nested state.
     */
    const toggleCategory = (categoryId: string) => {
        setExpandedCategoryId(prev => prev === categoryId ? null : categoryId);
        setExpandedSubcategoryId(null);
    };

    /**
     * Toggles the expanded state of a nested subcategory inside the open
     * category dropdown. Mirrors the single-open invariant of toggleCategory:
     * opening a different subcategory id collapses the previously expanded one.
     *
     * @param subcategoryId - Menu node id of the second-level container being toggled
     */
    const toggleSubcategory = (subcategoryId: string) => {
        setExpandedSubcategoryId(prev => prev === subcategoryId ? null : subcategoryId);
    };

    /**
     * Return an item's label in the page's language.
     *
     * Labels are stored in English, so they go through the translator like
     * any other visible text. On an English page this returns the stored
     * label unchanged; on a translated page it returns the saved translation,
     * or the English label when none exists yet. The key comes from the
     * item's URL rather than its id so it survives a backend restart; see
     * `menuTranslationKey`.
     *
     * @param item - The menu item being rendered.
     * @returns The label to show and announce.
     */
    const labelOf = (item: MenuNodeSerialized): string => t(menuTranslationKey(namespace, item), item.label);

    /**
     * Build the accessible name of a button that opens or closes an item's
     * submenu, so screen readers hear it in the page's language too.
     *
     * @param label - The item's already-translated label.
     * @param isExpanded - Whether the submenu is open, which decides the verb.
     * @returns The button's `aria-label`.
     */
    const submenuToggleLabel = (label: string, isExpanded: boolean): string => (isExpanded
        ? t('menu.nav.collapseSubmenu', 'Collapse {label} submenu', { label })
        : t('menu.nav.expandSubmenu', 'Expand {label} submenu', { label }));

    /**
     * Build the accessible name of an open submenu panel.
     *
     * @param label - The already-translated label of the item that owns the panel.
     * @returns The panel's `aria-label`.
     */
    const submenuPanelLabel = (label: string): string => t('menu.nav.submenu', '{label} submenu', { label });

    /**
     * Renders a link menu item.
     *
     * For nested links (inside category dropdowns), dispatches a mousedown event
     * on document.body to trigger PriorityNav's click-outside handler. This ensures
     * the "More" dropdown also closes when selecting a child link from a category
     * that overflowed into the "More" menu.
     */
    const renderLinkItem = (item: MenuNodeSerialized, isNested = false): JSX.Element => {
        // The stored url is unprefixed; on a translated page the link and the
        // pathname both carry the language prefix when the target is live in
        // that language, so highlighting compares against the localized link.
        const href = item.url ? localizeHref(item.url) : item.url!;

        // When the caller supplies `activeUrl` (in-page tab mode) the active
        // item is the one whose url matches it exactly — the route does not
        // change between tabs, so pathname matching cannot tell them apart.
        // Without it, fall back to pathname matching for navigation links.
        const isActive = activeUrl !== undefined
            ? item.url === activeUrl
            : item.url === '/'
                ? pathname === href
                : !!item.url && pathname.startsWith(href);

        // Nested rows (inside category dropdowns) are vertical-list items
        // where icon-top and label-hiding both degrade readability. Force
        // left position and always-on labels for that surface; top-level
        // PriorityNav items honor the configured position and
        // `showLabels` toggle.
        const rowIconEnabled = iconsEnabled && !!item.icon;
        const rowIconPosition: IconPosition = isNested ? 'left' : iconPosition;
        const rowShowLabels = isNested ? true : showLabels;
        const iconStackTop = rowIconEnabled && rowIconPosition === 'top';

        const className = [
            styles.tab,
            isActive ? styles.active : '',
            isNested ? styles.nested : '',
            rowIconEnabled ? styles['tab--withIcon'] : '',
            iconStackTop ? styles['tab--iconTop'] : ''
        ].filter(Boolean).join(' ');

        const icon = rowIconEnabled
            ? <MenuNodeIcon name={item.icon!} size={16} />
            : null;
        const labelText = labelOf(item);
        const label = rowShowLabels
            ? <span>{labelText}</span>
            : <span className={styles.sr_only}>{labelText}</span>;

        return (
            <Link
                key={item._id}
                href={href}
                className={className}
                role={isNested ? 'menuitem' : undefined}
                aria-current={isActive ? 'page' : undefined}
                aria-label={rowShowLabels ? undefined : labelText}
                onClick={(event) => {
                    // Opt-in activation: when the caller provides onItemSelect,
                    // the item drives in-page state (e.g. a `?tab=` submenu)
                    // instead of navigating. Preventing default keeps the
                    // <Link> href intact for SSR and no-JS visitors while
                    // suppressing client-side navigation. Omitting the handler
                    // preserves ordinary link navigation for existing consumers.
                    if (onItemSelect) {
                        event.preventDefault();
                        onItemSelect(item, event);
                    }
                    if (isNested) {
                        closeDropdown();
                        // Trigger PriorityNav's click-outside handler to close "More" dropdown
                        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    }
                }}
            >
                {rowIconPosition !== 'right' && icon}
                {label}
                {rowIconPosition === 'right' && icon}
            </Link>
        );
    };

    /**
     * Renders a category as a toggle button for the dropdown.
     *
     * Clicking anywhere on the category opens the dropdown, which shows the
     * category itself as the first item (acting as the navigable link) followed
     * by its children. Uses stopPropagation to prevent PriorityNav's "More"
     * dropdown from closing when the category is clicked.
     */
    const renderCategoryToggle = (item: MenuNodeSerialized): JSX.Element => {
        const isExpanded = expandedCategoryId === item._id;
        const href = item.url ? localizeHref(item.url) : undefined;
        const isActive = href
            ? (item.url === '/' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`))
            : false;

        const rowIconEnabled = iconsEnabled && !!item.icon;
        const iconStackTop = rowIconEnabled && iconPosition === 'top';

        const buttonClassName = [
            styles.categoryButton,
            isActive ? styles.active : '',
            iconStackTop ? styles['categoryButton--iconTop'] : ''
        ].filter(Boolean).join(' ');

        const icon = rowIconEnabled
            ? <MenuNodeIcon name={item.icon!} size={16} />
            : null;
        const labelText = labelOf(item);
        const label = showLabels
            ? <span>{labelText}</span>
            : <span className={styles.sr_only}>{labelText}</span>;
        const chevron = isExpanded ? (
            <ChevronDown size={16} className={styles.categoryChevron} />
        ) : (
            <ChevronRight size={16} className={styles.categoryChevron} />
        );

        return (
            <div key={item._id} className={styles.category}>
                <button
                    type="button"
                    ref={(el) => {
                        if (el) {
                            categoryButtonRefs.current.set(item._id, el);
                        } else {
                            categoryButtonRefs.current.delete(item._id);
                        }
                    }}
                    className={buttonClassName}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleCategory(item._id);
                    }}
                    aria-expanded={isExpanded}
                    aria-haspopup="true"
                    aria-label={submenuToggleLabel(labelText, isExpanded)}
                >
                    {iconPosition !== 'right' && icon}
                    {iconStackTop ? (
                        // In icon-top mode the button is `flex-direction: column`,
                        // so each child sits on its own line. Group label+chevron
                        // in a row span so the chevron stays inline with the
                        // label instead of stacking under it.
                        <span className={styles.categoryButton__row}>
                            {label}
                            {chevron}
                        </span>
                    ) : (
                        <>
                            {label}
                            {iconPosition === 'right' && icon}
                            {chevron}
                        </>
                    )}
                </button>
            </div>
        );
    };

    /**
     * Renders menu items - categories get link + chevron, leaves get links.
     */
    const renderMenuItem = (item: MenuNodeSerialized): JSX.Element => {
        const hasChildren = item.children && item.children.length > 0;

        // Category node with children - render link + dropdown chevron
        if (hasChildren) {
            return renderCategoryToggle(item);
        }

        // Link node - render as navigation link
        if (item.url) {
            return renderLinkItem(item);
        }

        // Fallback for invalid nodes
        return <span key={item._id}>{labelOf(item)}</span>;
    };

    /**
     * Get the expanded category item for rendering its dropdown.
     */
    const expandedCategory = expandedCategoryId
        ? visibleItems.find(item => item._id === expandedCategoryId)
        : null;

    /**
     * Get position for the dropdown based on the button's bounding rect.
     */
    const getDropdownPosition = () => {
        if (!expandedCategoryId) return { top: 0, left: 0 };
        const button = categoryButtonRefs.current.get(expandedCategoryId);
        if (!button) return { top: 0, left: 0 };
        const rect = button.getBoundingClientRect();
        return {
            top: rect.bottom + 8,
            left: rect.left
        };
    };

    /**
     * Converts menu items to PriorityNav format.
     */
    const priorityNavItems = visibleItems.map(item => ({
        id: item._id,
        node: renderMenuItem(item)
    }));

    const navAriaLabel = ariaLabel || t('menu.nav.ariaLabel', '{namespace} navigation', { namespace });

    /**
     * Renders one row inside an expanded category dropdown.
     *
     * Leaf rows render as a navigation link. Rows whose node has its own
     * children render as a second-level toggle paired with a sub-panel
     * containing the node's own link (when it has a URL) plus its
     * grandchildren. The sub-panel positions as a side flyout above the
     * mobile breakpoint and as an inline accordion below it via CSS in
     * MenuNav.module.scss — there is no JS branch for viewport.
     *
     * @param child - Menu node to render
     * @returns Dropdown row JSX
     */
    const renderDropdownChild = (child: MenuNodeSerialized): JSX.Element => {
        const hasChildren = !!(child.children && child.children.length > 0);

        if (!hasChildren) {
            return (
                <div key={child._id} className={styles.categoryDropdownItem} role="none">
                    {renderLinkItem(child, true)}
                </div>
            );
        }

        const isSubExpanded = expandedSubcategoryId === child._id;
        const childHref = child.url ? localizeHref(child.url) : undefined;
        const isActive = childHref
            ? (pathname === childHref || pathname.startsWith(`${childHref}/`))
            : false;
        const childLabel = labelOf(child);

        return (
            <div key={child._id} className={styles.categoryDropdownItem} role="none">
                <button
                    type="button"
                    className={`${styles.subcategoryButton} ${isActive ? styles.active : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleSubcategory(child._id);
                    }}
                    role="menuitem"
                    aria-expanded={isSubExpanded}
                    aria-haspopup="menu"
                    aria-label={submenuToggleLabel(childLabel, isSubExpanded)}
                >
                    <span>{childLabel}</span>
                    {isSubExpanded ? (
                        <ChevronDown size={14} className={styles.subcategoryChevron} />
                    ) : (
                        <ChevronRight size={14} className={styles.subcategoryChevron} />
                    )}
                </button>
                {isSubExpanded && (
                    <div
                        className={styles.subcategoryPanel}
                        role="menu"
                        aria-label={submenuPanelLabel(childLabel)}
                    >
                        {child.url && (
                            <div className={styles.categoryDropdownItem} role="none">
                                {renderLinkItem(child, true)}
                            </div>
                        )}
                        {child.children!.map(grandchild => (
                            <div
                                key={grandchild._id}
                                className={styles.categoryDropdownItem}
                                role="none"
                            >
                                {renderLinkItem(grandchild, true)}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    /**
     * Renders the category dropdown portal.
     * Portaled to document.body to escape overflow:hidden constraints.
     */
    const renderCategoryDropdown = () => {
        if (!isMounted || !expandedCategory || !expandedCategory.children) {
            return null;
        }

        const position = getDropdownPosition();

        // The portal lives under <body>, outside the <nav> that carries the
        // compact class — descendant selectors anchored on `.nav--compact`
        // would never match the dropdown contents. Tagging the dropdown root
        // and the backdrop with the same compact class brings the rule scope
        // into the portal so `.subcategoryButton` and other dropdown rows
        // honor `styling.compact`.
        const dropdownClassName = [styles.categoryDropdown, isCompact ? styles['nav--compact'] : '']
            .filter(Boolean).join(' ');
        const backdropClassName = [styles.categoryBackdrop, isCompact ? styles['nav--compact'] : '']
            .filter(Boolean).join(' ');

        return createPortal(
            <>
                {/* Backdrop - prevents interaction with page behind sheet */}
                <div
                    className={backdropClassName}
                    aria-hidden="true"
                    onClick={closeDropdown}
                    onTouchMove={(e) => e.preventDefault()}
                />
                {/* Dropdown panel */}
                <div
                    ref={dropdownRef}
                    className={dropdownClassName}
                    role="menu"
                    aria-label={submenuPanelLabel(labelOf(expandedCategory))}
                    style={{
                        top: position.top,
                        left: position.left
                    }}
                >
                    {expandedCategory.url && (
                        <div
                            className={styles.categoryDropdownItem}
                            role="none"
                        >
                            {renderLinkItem(expandedCategory, true)}
                        </div>
                    )}
                    {expandedCategory.children.map(child => renderDropdownChild(child))}
                </div>
            </>,
            document.body
        );
    };

    const navClassName = [
        styles.nav,
        hasInitialized ? styles['nav--initialized'] : '',
        isCompact ? styles['nav--compact'] : ''
    ].filter(Boolean).join(' ');

    // Always render PriorityNav to maintain consistent single-row layout.
    // The fallback wrapped layout caused vertical overflow during loading,
    // creating a layout shift when switching to PriorityNav.
    if (overflowEnabled) {
        return (
            <>
                <nav className={navClassName} aria-label={navAriaLabel}>
                    <PriorityNav
                        items={priorityNavItems}
                        enabled={overflowEnabled}
                        collapseAtCount={menuConfig.overflow?.collapseAtCount}
                        moreButtonLabel={t('menu.nav.more', 'More {namespace} menu items', { namespace })}
                        onInitialized={handlePriorityNavInitialized}
                    />
                </nav>
                {renderCategoryDropdown()}
            </>
        );
    }

    // Fallback only used when overflow is explicitly disabled
    return (
        <>
            <nav className={`${navClassName} ${styles['nav--wrap']}`} aria-label={navAriaLabel}>
                {visibleItems.map(item => renderMenuItem(item))}
            </nav>
            {renderCategoryDropdown()}
        </>
    );
}
