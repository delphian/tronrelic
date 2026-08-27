'use client';

/**
 * @fileoverview Client shell for /system/address-tags.
 *
 * Holds the in-page tab row and its five tab panels: the tag management table,
 * the ingestion source status panel, the ingestion settings form, this
 * module's scheduler jobs, and this module's MongoDB storage. The tab row is
 * the menu module's Submenu Pattern — a namespaced menu rendered with
 * `MenuNavClient`, not a hand-rolled button array — so it inherits per-user
 * gating, ordering, and live `menu:update` refresh. The server entry
 * (`page.tsx`) fetches that namespace tree SSR-first and passes it in. Clicking
 * a tab drives local state via `onItemSelect` rather than navigating;
 * `activeUrl` highlights the active tab since the route is identical across
 * them.
 *
 * The Schedules and Database panels are core components filtered to this
 * module, not anything written for this page. Any component that owns a
 * scheduler job or a collection surfaces both on its own admin page, and
 * reusing the core browsers means the authority behind these two tabs is the
 * same one `/system/scheduler` and `/system/database` use — so a schedule
 * edited here and a schedule edited there can never disagree.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, PageHeader } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../../modules/database';
import { SchedulerMonitor, type SchedulerJob } from '../../../../modules/scheduler';
import { AddressTagsManager } from './AddressTagsManager';
import { SourcesTab } from './SourcesTab';
import { SettingsTab } from './SettingsTab';
import styles from './page.module.scss';

/** The page's five tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'tags' | 'sources' | 'settings' | 'schedules' | 'database';

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'address-tags';

/**
 * Name prefix shared by every scheduler job the module registers.
 *
 * The Schedules tab filters on the prefix rather than listing job names, so a
 * job the module adds later appears here without a matching edit to this file.
 * The literal is repeated from `AddressTagsModule.ts` because frontend code
 * cannot import backend code; the module's lifecycle test asserts every
 * registered job name starts with it, which is what keeps the two copies
 * honest.
 */
const JOB_PREFIX = 'address-tags:';

/**
 * Physical MongoDB collection prefix covering everything this module owns.
 *
 * A module prefixes its collections by hand as `module_<id>_<name>`, so this
 * string names exactly the storage the module is responsible for, and scoping
 * the browser to it keeps the panel on this module's data instead of the whole
 * deployment's inventory. The module's ingestion cursors, run state, and
 * settings are key-value entries rather than collections, and those live in the
 * shared `_kv` collection alongside every other module's. That collection falls
 * outside this prefix on purpose and stays reachable from `/system/database`,
 * which is the right home for storage no single module owns.
 */
const COLLECTION_PREFIX = 'module_address-tags_';

/**
 * Type guard narrowing an arbitrary `?tab=` string to a known TabId, so the
 * deep-link seeding and click routing share one source of truth for valid tabs.
 *
 * @param tab - The raw `?tab=` value.
 * @returns True when the value names a real tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'tags'
        || tab === 'sources'
        || tab === 'settings'
        || tab === 'schedules'
        || tab === 'database';
}

/**
 * Select this module's scheduler jobs for the Schedules tab.
 *
 * A predicate rather than a fixed list of names, so the tab keeps its promise
 * of showing "this module's schedules" when another ingestion job is added.
 *
 * @param job - A job row supplied by the scheduler monitor.
 * @returns True when the job belongs to this module.
 */
function isAddressTagsJob(job: SchedulerJob): boolean {
    return job.name.startsWith(JOB_PREFIX);
}

/**
 * Resolve a submenu node's `?tab=` value to a known TabId, defaulting to
 * `tags` for an unrecognized or missing value so a malformed node can never
 * leave the page on a blank panel.
 *
 * @param url - The clicked node's url (e.g. `/system/address-tags?tab=sources`).
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'tags';
}

/**
 * Props for the client shell.
 */
interface IAddressTagsAdminClientProps {
    /** SSR-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /**
     * The `?tab=` value from the request URL, read SSR-first in `page.tsx` so a
     * refreshed, bookmarked, or shared deep link opens on the right panel. An
     * unknown or absent value resolves to `tags`.
     */
    initialTab?: string;
}

/**
 * Address-tags admin client shell: header, tab row, and the active panel.
 *
 * @param props - SSR submenu tree, its timestamp, and the deep-linked initial tab.
 * @returns The page.
 */
export function AddressTagsAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IAddressTagsAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'tags');

    /**
     * Activate the clicked tab and keep its URL a real deep link.
     *
     * `MenuNavClient` suppresses the <Link> navigation when `onItemSelect` is
     * set, so without this the address bar would never reflect the selected tab
     * and a refresh, bookmark, or shared link would fall back to the Tags
     * panel. Rewriting the address in place with `history.replaceState` needs
     * no server round-trip and no `useSearchParams` Suspense boundary;
     * `page.tsx` reads the value SSR-first to seed the panel on next load.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/address-tags?tab=${tab}`);
    }, []);

    return (
        <Page>
            <PageHeader
                title="Address Tags"
                subtitle="Create, rename, and remove text tags attached to TRON wallet addresses, and manage the machine sources that assert sanctions and freeze tags."
            />

            <div className={styles.submenu}>
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Address tags sections"
                    activeUrl={`/system/address-tags?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />
            </div>

            <div className={styles.content}>
                {activeTab === 'tags' && <AddressTagsManager />}
                {activeTab === 'sources' && <SourcesTab />}
                {activeTab === 'settings' && <SettingsTab />}
                {activeTab === 'schedules' && (
                    <SchedulerMonitor
                        jobFilter={isAddressTagsJob}
                        title="Address Tags Schedules"
                        hideStats
                    />
                )}

                {/* Editing and deletion stay enabled: a tag document is a
                  * standalone `(address, tag)` row that nothing else derives
                  * from, so a correction here strands no other data. Prefer the
                  * Tags tab for ordinary work, because it goes through the
                  * service and keeps the `active` liveness flag consistent with
                  * the `manual` claim and the `sources` array; treat this
                  * browser as the escape hatch for a document that surface
                  * cannot reach, such as one still missing its provenance
                  * fields before the 001 migration runs. */}
                {activeTab === 'database' && (
                    <CollectionBrowser
                        prefix={COLLECTION_PREFIX}
                        title="Address Tags Collections"
                    />
                )}
            </div>
        </Page>
    );
}
