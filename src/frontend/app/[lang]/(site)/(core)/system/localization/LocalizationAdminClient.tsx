'use client';

/**
 * @fileoverview Client shell for /system/localization.
 *
 * Holds the in-page tab row and its five panels: languages, published routes,
 * translations, this module's MongoDB storage, and this module's log entries.
 * The tab row is the menu module's Submenu Pattern — a namespaced menu rendered
 * with `MenuNavClient` — and clicking a tab drives local state rather than
 * navigating, with the address bar kept as a real deep link.
 *
 * The Database and Logs panels are core components scoped to this module, so
 * an operator diagnosing a missing translation or a refused language can read
 * the module's storage and its warnings without leaving the page. The module
 * owns no scheduler jobs, so there is no Schedules tab.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, PageHeader } from '../../../../../../components/layout';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { LanguagesTab, RoutesTab, TranslationsTab } from '../../../../../../modules/localization';
import styles from './page.module.scss';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'languages' | 'routes' | 'translations' | 'database' | 'logs';

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'localization';

/**
 * Physical collection prefix covering everything this module owns. Repeated
 * from the backend module because frontend code cannot import backend code.
 */
const COLLECTION_PREFIX = 'module_localization_';

/** Log service name a module logging through `logger.child({ module: 'localization' })` records under. */
const LOG_SERVICE = 'tronrelic:localization';

/**
 * Narrow an arbitrary `?tab=` string to a known tab, so the deep link and the
 * click handler share one list of valid tabs.
 *
 * @param tab - The raw `?tab=` value.
 * @returns True when the value names a real tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'languages' || tab === 'routes' || tab === 'translations' || tab === 'database' || tab === 'logs';
}

/**
 * Resolve a submenu node's `?tab=` value, defaulting to `languages` so a
 * malformed node never leaves the page on a blank panel.
 *
 * @param url - The clicked node's url, e.g. `/system/localization?tab=routes`.
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'languages';
}

/** Props for the client shell. */
interface ILocalizationAdminClientProps {
    /** Server-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown or absent opens Languages. */
    initialTab?: string;
}

/**
 * Localization admin shell: header, tab row, and the active panel.
 *
 * @param props - Submenu tree, its timestamp, and the deep-linked tab.
 * @returns The page.
 */
export function LocalizationAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: ILocalizationAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'languages');
    const [routeFilter, setRouteFilter] = useState<string | undefined>(undefined);

    /**
     * Switch to the clicked tab and keep the address bar a real deep link.
     * `MenuNavClient` suppresses navigation when `onItemSelect` is set, so the
     * URL is rewritten in place.
     *
     * @param item - The clicked submenu node.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/localization?tab=${tab}`);
    }, []);

    /**
     * Open the Translations tab filtered to the keys rendered on one route,
     * which is how an administrator fills a route's gaps before publishing it.
     *
     * @param pattern - The route pattern to filter by.
     */
    const handleShowKeys = useCallback((pattern: string) => {
        setRouteFilter(pattern);
        setActiveTab('translations');
        window.history.replaceState(null, '', '/system/localization?tab=translations');
    }, []);

    return (
        <Page>
            <PageHeader
                title="Localization"
                subtitle="Languages, the routes published in each, and the translations visitors see. English is the default and needs no setup."
            />

            <div className={styles.submenu}>
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Localization sections"
                    activeUrl={`/system/localization?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />
            </div>

            <div className={styles.content}>
                {activeTab === 'languages' && <LanguagesTab />}
                {activeTab === 'routes' && <RoutesTab onShowKeys={handleShowKeys} />}
                {activeTab === 'translations' && <TranslationsTab initialRoute={routeFilter} />}
                {activeTab === 'database' && (
                    <CollectionBrowser prefix={COLLECTION_PREFIX} title="Localization Collections" />
                )}
                {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} />}
            </div>
        </Page>
    );
}
