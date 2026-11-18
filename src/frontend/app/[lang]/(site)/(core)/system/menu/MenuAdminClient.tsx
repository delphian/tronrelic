'use client';

/**
 * @fileoverview Client shell for /system/menu.
 *
 * Holds the in-page tab row and its four panels: the active namespace's
 * items, that namespace's rendering configuration, this module's MongoDB
 * storage, and this module's log entries. The tab row is the Submenu Pattern
 * the menu module itself defines — a namespaced menu rendered with
 * `MenuNavClient` — and clicking a tab drives local state rather than
 * navigating, with the address bar kept as a real deep link. The server entry
 * (`page.tsx`) fetches that namespace tree and the `?tab=` value.
 *
 * The Items and Configuration panels share the namespace selector above them
 * and load their data after mounting over the cookie-authenticated admin API.
 * The Database and Logs panels are core components scoped to this module, so
 * an operator can read the stored nodes, overrides, and namespace settings,
 * and the module's log entries, without leaving the page.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Bot, Pencil, Plus, Trash2, User, type LucideIcon } from 'lucide-react';
import type {
    IMenuNamespaceConfig,
    IMenuNode,
    IMenuNodeAdminView,
    IMenuTreeAdminView,
    IUserGroup,
    MenuNodeOrigin
} from '@/types';
import type { MenuNodeSerialized } from '@/shared';

import { AdminPage, Stack } from '../../../../../../components/layout';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { MenuNodeIcon } from '../../../../../../components/layout/MenuNav/MenuNodeIcon';
import { CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { Badge } from '../../../../../../components/ui/Badge';
import { Button } from '../../../../../../components/ui/Button';
import { Field } from '../../../../../../components/ui/Field';
import { IconButton } from '../../../../../../components/ui/IconButton';
import { Input } from '../../../../../../components/ui/Input';
import { Panel } from '../../../../../../components/ui/Panel';
import { Switch } from '../../../../../../components/ui/Switch';
import { Select } from '../../../../../../components/ui/Select';
import { Tbody, Td, Th, Thead, Tr, Table } from '../../../../../../components/ui/Table';
import { useModal } from '../../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import { ConfirmDialog } from '../../../../../../components/ui/ConfirmDialog';
import { LazyIconPickerModal } from '../../../../../../components/ui/IconPickerModal';

import styles from './menu.module.scss';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'items' | 'configuration' | 'database' | 'logs';

/** Every tab id, so the deep link and the click handler share one list. */
const TAB_IDS: ReadonlyArray<TabId> = ['items', 'configuration', 'database', 'logs'];

/** The menu namespace the menu module registers this page's tab nodes under. */
const SUBMENU_NAMESPACE = 'menu';

/**
 * Physical collection prefix covering everything this module owns:
 * `menu_nodes`, `menu_node_overrides`, and `menu_namespace_config`. The
 * collections predate the `module_<id>_` convention, and no other collection
 * starts with this prefix. Repeated from the backend module because frontend
 * code cannot import backend code.
 */
const COLLECTION_PREFIX = 'menu_';

/**
 * Log service name the module records under. `MenuModule` logs through
 * `logger.child({ module: 'menu' })` and hands that logger to `MenuService`,
 * so node and configuration changes are filed here too.
 */
const LOG_SERVICE = 'tronrelic:menu';

/** Narrow an arbitrary `?tab=` string to a known tab. */
function isTabId(tab: string | undefined): tab is TabId {
    return TAB_IDS.includes(tab as TabId);
}

/**
 * Resolve a submenu node's `?tab=` value, defaulting to `items` so a malformed
 * node never leaves the page on a blank panel.
 *
 * @param url - The clicked node's url, e.g. `/system/menu?tab=logs`.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'items';
}

/** Props for the client shell. */
interface IMenuAdminClientProps {
    /** Server-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown or absent opens Items. */
    initialTab?: string;
}

/** One row of the items table: a node and how deep it sits in the tree. */
interface IFlatNode {
    /** The node the row shows. */
    node: IMenuNodeAdminView;
    /** 0 for a root, 1 for its children, and so on; drives the indentation. */
    depth: number;
}

// `plugin-overridden` keeps the warning tone (and `Plugin` label) so an
// operator can spot rows that carry admin customizations without needing
// extra suffix text. Default `plugin` and `manual` both read as success —
// the row is in a clean, expected state. Override state is conveyed via
// `aria-label` on the warning variant so screen readers can distinguish
// the two `Plugin` rows even though their visible text matches (WCAG 1.4.1).
const ORIGIN_BADGE: Record<
    MenuNodeOrigin,
    { label: string; tone: 'success' | 'warning'; icon: LucideIcon; ariaLabel?: string }
> = {
    manual: { label: 'Manual', tone: 'success', icon: User },
    plugin: { label: 'Plugin', tone: 'success', icon: Bot },
    'plugin-overridden': { label: 'Plugin', tone: 'warning', icon: Bot, ariaLabel: 'Plugin (overridden)' }
};

/**
 * Show who owns a row — an admin or a plugin — and whether a plugin row
 * carries a saved override, which decides what deleting it does.
 *
 * @param props.origin - The origin tag the admin tree read computed for the row.
 * @returns A small badge, sized for a dense table row.
 */
function OriginBadge({ origin }: { origin: MenuNodeOrigin }) {
    const { label, tone, icon: Icon, ariaLabel } = ORIGIN_BADGE[origin];
    return (
        <Badge tone={tone} size="sm" aria-label={ariaLabel}>
            <Icon size={12} aria-hidden />
            {label}
        </Badge>
    );
}

/**
 * Flatten a parent-child node list into a depth-aware sequence so a single
 * <Table> can render the whole hierarchy. Roots first, then a depth-first
 * descent ordered by `order` at each level.
 *
 * Orphans — nodes whose `parent` id is not present in the input — are
 * bucketed under `null` so they appear as roots. This mirrors the backend
 * `buildTree`, which also treats unknown parents as roots, and keeps the
 * admin table a complete view of state so operators can see (and fix or
 * delete) orphans instead of having them silently disappear.
 *
 * @param nodes - Every node of the namespace, in any order.
 * @returns The nodes in table order, each with its depth.
 */
function flattenTree(nodes: IMenuNodeAdminView[]): IFlatNode[] {
    const knownIds = new Set<string>();
    for (const node of nodes) {
        if (node._id) knownIds.add(node._id);
    }

    const byParent = new Map<string | null, IMenuNodeAdminView[]>();
    for (const node of nodes) {
        const key = node.parent && knownIds.has(node.parent) ? node.parent : null;
        const bucket = byParent.get(key) ?? [];
        bucket.push(node);
        byParent.set(key, bucket);
    }
    for (const bucket of byParent.values()) {
        bucket.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    }

    const out: IFlatNode[] = [];

    /**
     * Append one parent's children, each followed by its own subtree, so a
     * child always lands directly under its parent.
     *
     * @param parentId - The parent whose children to append; null for roots.
     * @param depth - The depth those children sit at.
     */
    const walk = (parentId: string | null, depth: number): void => {
        const bucket = byParent.get(parentId) ?? [];
        for (const node of bucket) {
            out.push({ node, depth });
            if (node._id) walk(node._id, depth + 1);
        }
    };
    walk(null, 0);
    return out;
}

/**
 * Menu administration shell: header, tab row, and the active panel.
 *
 * Compact, table-driven view for managing menu nodes and namespace
 * configuration. Items render as a single flat <Table> with children
 * indented under their parents; create/edit happens in modals, deletes
 * confirm via modal, success/error surface via toasts.
 *
 * Lives behind /system, which is admin-gated by SystemAuthGate via the
 * Better Auth session. Same-origin fetches carry the session cookie, so
 * the page fetches after mount with no explicit auth header (same
 * convention as /system/plugins, /system/theme, /system/users).
 *
 * @param props - Submenu tree, its timestamp, and the deep-linked tab.
 * @returns The page.
 */
export function MenuAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IMenuAdminClientProps) {
    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'items');
    const [namespaces, setNamespaces] = useState<string[]>([]);
    const [activeNamespace, setActiveNamespace] = useState<string>('main');

    const [menuTree, setMenuTree] = useState<IMenuTreeAdminView | null>(null);
    const [config, setConfig] = useState<IMenuNamespaceConfig | null>(null);
    const [loading, setLoading] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
    // Admin-defined groups for the gating fieldset multi-select. Populated
    // once on mount; group definition changes are infrequent enough that we
    // don't subscribe to live updates here.
    const [availableGroups, setAvailableGroups] = useState<IUserGroup[]>([]);

    /**
     * Tell the operator an action failed and why, in one shape for every
     * request on the page.
     *
     * @param title - What the operator was trying to do.
     * @param err - The thrown value, whose message becomes the description.
     */
    const notifyError = useCallback(
        (title: string, err: unknown) => {
            pushToast({
                tone: 'danger',
                title,
                description: err instanceof Error ? err.message : String(err)
            });
        },
        [pushToast]
    );

    /**
     * Confirm a change landed, so the operator does not have to reload to check.
     *
     * @param title - What changed.
     */
    const notifySuccess = useCallback(
        (title: string) => pushToast({ tone: 'success', title }),
        [pushToast]
    );

    /**
     * Read a namespace's full origin-tagged tree, including disabled and
     * gated rows, which only the admin read returns.
     *
     * @param namespace - The namespace to read.
     * @returns The tree the Items tab flattens.
     */
    const fetchTree = useCallback(
        async (namespace: string) => {
            const res = await fetch(`/api/menu/manage?namespace=${encodeURIComponent(namespace)}`);
            if (!res.ok) throw new Error('Failed to load menu tree');
            const data = await res.json();
            // `/api/menu/manage` returns the origin-tagged projection.
            // The route is `requireAdmin`-gated so the cast is always
            // valid for callers reaching this code path.
            return data.tree as IMenuTreeAdminView;
        },
        []
    );

    /**
     * Read a namespace's rendering configuration, which the backend fills
     * with defaults when none is stored.
     *
     * @param namespace - The namespace to read.
     * @returns The configuration the Configuration tab edits.
     */
    const fetchConfig = useCallback(
        async (namespace: string) => {
            const res = await fetch(
                `/api/menu/namespace/${encodeURIComponent(namespace)}/config`
            );
            if (!res.ok) throw new Error('Failed to load namespace configuration');
            const data = await res.json();
            return data.config as IMenuNamespaceConfig;
        },
        []
    );

    /**
     * Load the namespace list once after mounting. If `main` is not among
     * them, switch to the first namespace that exists, so the tabs never ask
     * for a namespace with nothing in it.
     */
    useEffect(() => {
        let cancelled = false;

        /** Fetch the list and keep the active namespace one that exists. */
        const load = async (): Promise<void> => {
            try {
                const res = await fetch('/api/menu/namespaces');
                if (!res.ok) throw new Error('Failed to load namespaces');
                const data = await res.json();
                const list: string[] = data.namespaces ?? [];
                if (!cancelled) {
                    setNamespaces(list);
                    setActiveNamespace((current) =>
                        list.length > 0 && !list.includes(current) ? list[0] : current
                    );
                }
            } catch (err) {
                if (!cancelled) notifyError('Could not load namespaces', err);
            }
        };
        void load();

        return () => {
            cancelled = true;
        };
    }, [notifyError]);

    /**
     * Load the user groups the edit form's gating switches offer. Fetched
     * once; group definition changes are operator-driven and infrequent.
     * Errors are surfaced as a toast but don't block the page — operators can
     * still edit nodes whose gating fields don't depend on group selection.
     */
    useEffect(() => {
        let cancelled = false;

        /** Fetch the groups and store them for the edit form. */
        const load = async (): Promise<void> => {
            try {
                const res = await fetch('/api/admin/users/groups');
                if (!res.ok) throw new Error('Failed to load user groups');
                const data = await res.json();
                if (!cancelled) setAvailableGroups((data.groups ?? []) as IUserGroup[]);
            } catch (err) {
                if (!cancelled) notifyError('Could not load user groups', err);
            }
        };
        void load();

        return () => {
            cancelled = true;
        };
    }, [notifyError]);

    /**
     * Load the tree and the configuration of the active namespace whenever it
     * changes, so the Items and Configuration tabs always show the namespace
     * picked in the toolbar.
     */
    useEffect(() => {
        let cancelled = false;

        /** Fetch both reads together and store them. */
        const load = async (): Promise<void> => {
            setLoading(true);
            try {
                const [tree, cfg] = await Promise.all([
                    fetchTree(activeNamespace),
                    fetchConfig(activeNamespace)
                ]);
                if (!cancelled) {
                    setMenuTree(tree);
                    setConfig(cfg);
                }
            } catch (err) {
                if (!cancelled) notifyError('Could not load namespace data', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        if (activeNamespace) void load();

        return () => {
            cancelled = true;
        };
    }, [activeNamespace, fetchTree, fetchConfig, notifyError]);

    /** Re-read the active namespace's tree after a change, so the table shows what was saved. */
    const reloadTree = useCallback(async () => {
        try {
            const tree = await fetchTree(activeNamespace);
            setMenuTree(tree);
        } catch (err) {
            notifyError('Could not refresh menu tree', err);
        }
    }, [activeNamespace, fetchTree, notifyError]);

    /**
     * Create a persisted node in the active namespace.
     *
     * @param data - The form's fields.
     */
    const handleCreate = useCallback(
        async (data: Partial<IMenuNode>) => {
            const res = await fetch('/api/menu', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, namespace: activeNamespace })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Failed to create menu item');
            }
        },
        [activeNamespace]
    );

    /**
     * Save changed fields on a node. For a plugin's memory-only node the
     * backend stores them as an override that survives restarts.
     *
     * @param id - The node to change.
     * @param updates - Only the fields being changed.
     */
    const handleUpdate = useCallback(
        async (id: string, updates: Partial<IMenuNode>) => {
            const res = await fetch(`/api/menu/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Failed to update menu item');
            }
        },
        []
    );

    /**
     * Delete a node. The backend does not cascade, so its children become
     * roots until they are moved or deleted too.
     *
     * @param id - The node to delete.
     */
    const handleDelete = useCallback(
        async (id: string) => {
            const res = await fetch(`/api/menu/${id}`, {
                method: 'DELETE'
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Failed to delete menu item');
            }
        },
        []
    );

    /**
     * Save a single-field change made from a switch in the items table.
     *
     * The Enabled and In menu switches both save one field, refresh the tree,
     * and report the result, so they share this handler rather than each
     * repeating the busy-row and toast handling.
     *
     * @param node - The row whose switch was flipped
     * @param updates - The one field being changed
     * @param successTitle - Toast text telling the operator what changed
     */
    const applyRowUpdate = useCallback(
        async (node: IMenuNode, updates: Partial<IMenuNode>, successTitle: string) => {
            if (node._id) {
                setBusyNodeId(node._id);
                try {
                    await handleUpdate(node._id, updates);
                    await reloadTree();
                    notifySuccess(successTitle);
                } catch (err) {
                    notifyError('Could not update menu item', err);
                } finally {
                    setBusyNodeId(null);
                }
            }
        },
        [handleUpdate, notifyError, notifySuccess, reloadTree]
    );

    /**
     * Turn a node on or off entirely. Turning it off also stops its category
     * landing page from resolving, unlike hiding it from the menu.
     *
     * @param node - The row whose switch was flipped.
     * @param next - True to enable the node, false to disable it.
     */
    const toggleEnabled = useCallback(
        (node: IMenuNode, next: boolean) =>
            applyRowUpdate(node, { enabled: next }, next ? 'Menu item enabled' : 'Menu item disabled'),
        [applyRowUpdate]
    );

    /**
     * Show a node in navigation or hide it. A hidden node keeps working: its
     * landing page still resolves and it still appears on its parent's page.
     *
     * @param node - The row whose switch was flipped.
     * @param next - True to show the node in navigation, false to hide it
     */
    const toggleInMenu = useCallback(
        (node: IMenuNode, next: boolean) =>
            applyRowUpdate(node, { hidden: !next }, next ? 'Menu item shown in menu' : 'Menu item hidden from menu'),
        [applyRowUpdate]
    );

    /**
     * Open the create or edit form in a modal and save what it submits.
     *
     * @param mode - Whether the form creates a new node or edits `node`.
     * @param node - The node to edit; omitted when creating.
     */
    const openItemModal = useCallback(
        (mode: 'create' | 'edit', node?: IMenuNode) => {
            const id = openModal({
                title: mode === 'create' ? 'Create menu item' : `Edit "${node?.label ?? ''}"`,
                size: 'md',
                content: (
                    <MenuNodeForm
                        mode={mode}
                        initial={node}
                        availableParents={(menuTree?.all ?? []).filter((n) => n._id !== node?._id)}
                        availableGroups={availableGroups}
                        onCancel={() => closeModal(id)}
                        onSubmit={async (data) => {
                            try {
                                if (mode === 'create') {
                                    await handleCreate(data);
                                    notifySuccess('Menu item created');
                                } else if (node?._id) {
                                    await handleUpdate(node._id, data);
                                    notifySuccess('Menu item updated');
                                }
                                closeModal(id);
                                await reloadTree();
                            } catch (err) {
                                notifyError(
                                    mode === 'create' ? 'Could not create item' : 'Could not update item',
                                    err
                                );
                            }
                        }}
                    />
                )
            });
        },
        [availableGroups, closeModal, handleCreate, handleUpdate, menuTree?.all, notifyError, notifySuccess, openModal, reloadTree]
    );

    /**
     * Ask before deleting a node, and say up front when a plugin owns it,
     * because a plugin's row comes back on the next plugin load.
     *
     * @param node - The row to delete.
     */
    const openDeleteModal = useCallback(
        (node: IMenuNodeAdminView) => {
            if (node._id) {
                const nodeId = node._id;
                // Plugin-owned rows re-register on the next plugin load, so a
                // delete here only removes the in-memory copy until restart.
                // Surface that fact up front instead of leaving operators to
                // discover it the hard way after a deploy.
                const isPluginOwned = node.origin === 'plugin' || node.origin === 'plugin-overridden';
                const message = isPluginOwned ? (
                    <>
                        Delete <strong>{node.label}</strong>?
                        {' '}This row is owned by a plugin and will reappear on the next plugin load.
                        {node.origin === 'plugin-overridden' && (
                            <>
                                {' '}The saved override (label, order, icon, description, enabled, in menu) will also persist.
                                {' '}To remove the row permanently, disable the plugin.
                            </>
                        )}
                    </>
                ) : undefined;

                const id = openModal({
                    title: 'Delete menu item',
                    size: 'sm',
                    content: (
                        <ConfirmDialog
                            label={node.label}
                            message={message}
                            onCancel={() => closeModal(id)}
                            onConfirm={async () => {
                                try {
                                    await handleDelete(nodeId);
                                    notifySuccess('Menu item deleted');
                                    closeModal(id);
                                    await reloadTree();
                                } catch (err) {
                                    notifyError('Could not delete item', err);
                                }
                            }}
                        />
                    )
                });
            }
        },
        [closeModal, handleDelete, notifyError, notifySuccess, openModal, reloadTree]
    );

    /**
     * Open the form that names a new namespace and switch to it. Nothing is
     * stored until the first item or configuration is saved in it.
     */
    const openNamespaceModal = useCallback(() => {
        const id = openModal({
            title: 'Create namespace',
            size: 'sm',
            content: (
                <NamespaceForm
                    existing={namespaces}
                    onCancel={() => closeModal(id)}
                    onSubmit={(name) => {
                        setNamespaces((prev) =>
                            prev.includes(name) ? prev : [...prev, name].sort()
                        );
                        setActiveNamespace(name);
                        notifySuccess(`Switched to "${name}"`);
                        closeModal(id);
                    }}
                />
            )
        });
    }, [closeModal, namespaces, notifySuccess, openModal]);

    /** Store the edited configuration of the active namespace and show what the server kept. */
    const handleSaveConfig = useCallback(async () => {
        if (config && activeNamespace) {
            setSavingConfig(true);
            try {
                const res = await fetch(
                    `/api/menu/namespace/${encodeURIComponent(activeNamespace)}/config`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            overflow: config.overflow,
                            icons: config.icons,
                            layout: config.layout,
                            styling: config.styling
                        })
                    }
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || 'Failed to save configuration');
                }
                const data = await res.json();
                setConfig(data.config);
                notifySuccess(`Configuration saved for "${activeNamespace}"`);
            } catch (err) {
                notifyError('Could not save configuration', err);
            } finally {
                setSavingConfig(false);
            }
        }
    }, [activeNamespace, config, notifyError, notifySuccess]);

    /** Ask before resetting the active namespace's configuration to the defaults, then reload it. */
    const handleResetConfig = useCallback(() => {
        const id = openModal({
            title: 'Reset configuration',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={`${activeNamespace} configuration`}
                    confirmLabel="Reset"
                    message={`Reset "${activeNamespace}" namespace configuration to defaults?`}
                    onCancel={() => closeModal(id)}
                    onConfirm={async () => {
                        try {
                            const res = await fetch(
                                `/api/menu/namespace/${encodeURIComponent(activeNamespace)}/config`,
                                { method: 'DELETE' }
                            );
                            if (!res.ok) {
                                const body = await res.json().catch(() => ({}));
                                throw new Error(body.error || 'Failed to reset configuration');
                            }
                            const cfg = await fetchConfig(activeNamespace);
                            setConfig(cfg);
                            notifySuccess(`Configuration reset for "${activeNamespace}"`);
                            closeModal(id);
                        } catch (err) {
                            notifyError('Could not reset configuration', err);
                        }
                    }}
                />
            )
        });
    }, [activeNamespace, closeModal, fetchConfig, notifyError, notifySuccess, openModal]);

    const flatNodes = useMemo(
        () => (menuTree ? flattenTree(menuTree.all) : []),
        [menuTree]
    );

    /**
     * Switch to the clicked tab and keep the address bar a real deep link.
     * `MenuNavClient` suppresses navigation when `onItemSelect` is set, so the
     * URL is rewritten in place, and `page.tsx` reads it on the next load.
     *
     * @param item - The clicked tab node, whose url carries the `?tab=` value.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/menu?tab=${tab}`);
    }, []);

    // Items and Configuration both edit the namespace chosen in the toolbar,
    // so the toolbar shows only on those two tabs.
    const editsNamespace = activeTab === 'items' || activeTab === 'configuration';

    return (
        <AdminPage title="Menu" subtitle="Navigation items and per-namespace display settings.">
            <MenuNavClient
                namespace={SUBMENU_NAMESPACE}
                items={submenuTree}
                generatedAt={submenuGeneratedAt}
                ariaLabel="Menu administration sections"
                activeUrl={`/system/menu?tab=${activeTab}`}
                onItemSelect={handleTabSelect}
            />

            {editsNamespace && (
                <Stack gap="md">
                    <div className={styles.toolbar}>
                        <Field inline label="Namespace">
                            <Select
                                value={activeNamespace}
                                onChange={(e) => setActiveNamespace(e.target.value)}
                                disabled={loading}
                            >
                                {namespaces.length === 0 && (
                                    <option value={activeNamespace}>{activeNamespace}</option>
                                )}
                                {namespaces.map((ns) => (
                                    <option key={ns} value={ns}>
                                        {ns}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <IconButton
                            size="sm"
                            variant="primary"
                            aria-label="Create namespace"
                            title="Create namespace"
                            onClick={openNamespaceModal}
                        >
                            <Plus size={16} />
                        </IconButton>
                    </div>

                    {loading && <div className={styles.loading}>Loading…</div>}

                    {!loading && activeTab === 'items' && (
                        <ItemsTab
                            namespace={activeNamespace}
                            flatNodes={flatNodes}
                            busyNodeId={busyNodeId}
                            onCreate={() => openItemModal('create')}
                            onEdit={(node) => openItemModal('edit', node)}
                            onDelete={openDeleteModal}
                            onToggleEnabled={toggleEnabled}
                            onToggleInMenu={toggleInMenu}
                        />
                    )}

                    {!loading && activeTab === 'configuration' && config && (
                        <ConfigTab
                            config={config}
                            saving={savingConfig}
                            onChange={setConfig}
                            onSave={handleSaveConfig}
                            onReset={handleResetConfig}
                        />
                    )}
                </Stack>
            )}

            {/* Edits are off. The service loads these collections into memory
              * at startup and serves every read from there, so an edited
              * document would not reach the live menu until the next restart,
              * and the next save from the Items or Configuration tab would
              * overwrite it. Deletion stays on, because the browser is the
              * only place an admin can remove a stored override that a
              * removed plugin left behind; like an edit, it takes effect at
              * the next restart. */}
            {activeTab === 'database' && (
                <CollectionBrowser
                    prefix={COLLECTION_PREFIX}
                    title="Menu Collections"
                    allowEdit={false}
                />
            )}
            {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} />}
        </AdminPage>
    );
}

/* ------------------------------------------------------------------ */
/* Items tab                                                          */
/* ------------------------------------------------------------------ */

/** Props for the Items tab: the flattened tree and the row actions. */
interface IItemsTabProps {
    /** The namespace the table shows, named beside the item count. */
    namespace: string;
    /** Every node of the namespace in table order, with its depth. */
    flatNodes: IFlatNode[];
    /** The node whose switch is being saved, so its switches can be disabled meanwhile. */
    busyNodeId: string | null;
    /** Opens the create form. */
    onCreate: () => void;
    /** Opens the edit form for a row. */
    onEdit: (node: IMenuNodeAdminView) => void;
    /** Asks before deleting a row. */
    onDelete: (node: IMenuNodeAdminView) => void;
    /** Saves a row's Enabled switch. */
    onToggleEnabled: (node: IMenuNodeAdminView, next: boolean) => void;
    /** Saves a row's In menu switch. */
    onToggleInMenu: (node: IMenuNodeAdminView, next: boolean) => void;
}

/**
 * The Items tab: every node of the namespace as one flat table in a panel,
 * children indented under their parent, with the item count and the Create
 * button in the panel's header.
 *
 * The table fits a tablet unstacked, so it stacks only at 768px and below.
 * There each node becomes an entry headed by its indented label with its
 * Enabled switch beside it; that cell has no label and sits second so it
 * shares the heading line, and the edit and delete buttons go to the end of
 * the entry. The URL takes the width the other columns leave and is clipped
 * at that column's edge, with the full address in its tooltip.
 *
 * @param props - The flattened nodes, the node being saved, and the handlers
 *        each row's controls call.
 * @returns The panel holding the table, or the empty state.
 */
function ItemsTab({ namespace, flatNodes, busyNodeId, onCreate, onEdit, onDelete, onToggleEnabled, onToggleInMenu }: IItemsTabProps) {
    return (
        <Panel
            title="Items"
            meta={`${flatNodes.length} in ${namespace}`}
            actions={(
                <Button variant="primary" icon={<Plus size={16} />} onClick={onCreate}>
                    Create item
                </Button>
            )}
        >
            {flatNodes.length === 0 ? (
                <p className={styles.empty_state}>
                    No menu items yet. Create the first item to get started.
                </p>
            ) : (
                <Table variant="compact" flush stackAt="mobile">
                    <Thead>
                        <Tr>
                            <Th scope="col">Label</Th>
                            <Th scope="col" width="shrink">Enabled</Th>
                            <Th scope="col" width="expand">URL</Th>
                            <Th scope="col" width="shrink" numeric>Order</Th>
                            <Th scope="col" width="shrink">Origin</Th>
                            <Th scope="col" width="shrink">In menu</Th>
                            <Th scope="col" width="shrink">Actions</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {flatNodes.map(({ node, depth }) => (
                            <Tr key={node._id ?? `${node.label}-${node.order}`}>
                                <Td>
                                    <span
                                        className={styles.label_cell}
                                        style={{ '--menu-item-depth': depth } as CSSProperties}
                                    >
                                        <span className={styles.label_icon} title={node.icon || undefined}>
                                            {node.icon && <MenuNodeIcon name={node.icon} size={14} />}
                                        </span>
                                        <span className={styles.label_text}>{node.label}</span>
                                    </span>
                                </Td>
                                <Td>
                                    <Switch
                                        size="sm"
                                        on={node.enabled}
                                        onChange={(next) => onToggleEnabled(node, next)}
                                        disabled={busyNodeId === node._id}
                                        aria-label={`${node.enabled ? 'Disable' : 'Enable'} ${node.label}`}
                                    />
                                </Td>
                                <Td muted label="URL" stackSpan={2} className={styles.url_td}>
                                    <span className={styles.url_cell} title={node.url || undefined}>
                                        {node.url || '—'}
                                    </span>
                                </Td>
                                <Td numeric label="Order">{node.order}</Td>
                                <Td label="Origin">
                                    <OriginBadge origin={node.origin} />
                                </Td>
                                <Td label="In menu">
                                    <Switch
                                        size="sm"
                                        on={!node.hidden}
                                        onChange={(next) => onToggleInMenu(node, next)}
                                        disabled={busyNodeId === node._id}
                                        aria-label={`${node.hidden ? 'Show' : 'Hide'} ${node.label} in menu`}
                                    />
                                </Td>
                                <Td>
                                    <div className={styles.row_actions}>
                                        <IconButton
                                            size="sm"
                                            variant="primary"
                                            aria-label={`Edit ${node.label}`}
                                            title="Edit"
                                            onClick={() => onEdit(node)}
                                        >
                                            <Pencil size={14} />
                                        </IconButton>
                                        <IconButton
                                            size="sm"
                                            variant="danger"
                                            aria-label={`Delete ${node.label}`}
                                            title="Delete"
                                            onClick={() => onDelete(node)}
                                        >
                                            <Trash2 size={14} />
                                        </IconButton>
                                    </div>
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </Panel>
    );
}

/* ------------------------------------------------------------------ */
/* Configuration tab                                                  */
/* ------------------------------------------------------------------ */

/** Props for the Configuration tab. */
interface IConfigTabProps {
    /** The configuration being edited, unsaved changes included. */
    config: IMenuNamespaceConfig;
    /** True while a save is in flight, so the buttons show it. */
    saving: boolean;
    /** Receives the configuration with one setting changed. */
    onChange: (next: IMenuNamespaceConfig) => void;
    /** Stores the edited configuration. */
    onSave: () => void;
    /** Asks before restoring the defaults. */
    onReset: () => void;
}

/**
 * Turn a number field's text into a setting, where an empty field means the
 * setting is unset rather than zero.
 *
 * @param text - The field's current text.
 * @returns The number typed, or undefined when the field is empty.
 */
function parseOptionalCount(text: string): number | undefined {
    return text ? parseInt(text, 10) : undefined;
}

/**
 * The Configuration tab: the namespace's four groups of rendering settings
 * as panels, two to a row while the tab is wider than a large phone, with
 * Reset and Save right under them.
 *
 * Each group holds a switch and at most one short control, so a single
 * full-width column spread four short settings down the whole page and left
 * Save at the bottom of the screen. The number fields and the dropdowns keep
 * their own width instead of stretching across the panel.
 *
 * @param props - The configuration, the saving state, and the handlers.
 * @returns The panels and the actions under them.
 */
function ConfigTab({ config, saving, onChange, onSave, onReset }: IConfigTabProps) {
    const overflowEnabled = config.overflow?.enabled ?? true;
    const iconsEnabled = config.icons?.enabled ?? true;

    return (
        <div className={styles.config_layout}>
            <Stack gap="md">
                <div className={styles.config_grid}>
                    <Panel
                        title="Overflow"
                        meta="Move items past the visible width into a “More” dropdown using the Priority+ pattern."
                    >
                        <Field inline label="Enable overflow handling">
                            <Switch
                                on={overflowEnabled}
                                onChange={(next) =>
                                    onChange({
                                        ...config,
                                        overflow: { ...(config.overflow ?? {}), enabled: next }
                                    })
                                }
                                aria-label="Enable overflow handling"
                            />
                        </Field>

                        {overflowEnabled && (
                            <Field
                                label="Collapse at count"
                                hint="Collapse all items into “More” when fewer than this many would show."
                            >
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={20}
                                    className={styles.number_input}
                                    value={config.overflow?.collapseAtCount ?? ''}
                                    placeholder="No minimum"
                                    onChange={(e) =>
                                        onChange({
                                            ...config,
                                            overflow: {
                                                enabled: overflowEnabled,
                                                collapseAtCount: parseOptionalCount(e.target.value)
                                            }
                                        })
                                    }
                                />
                            </Field>
                        )}
                    </Panel>

                    <Panel title="Icons" meta="Show or hide icons next to labels.">
                        <Field inline label="Display icons">
                            <Switch
                                on={iconsEnabled}
                                onChange={(next) =>
                                    onChange({
                                        ...config,
                                        icons: {
                                            position: config.icons?.position ?? 'left',
                                            enabled: next
                                        }
                                    })
                                }
                                aria-label="Display icons"
                            />
                        </Field>

                        {iconsEnabled && (
                            <Field label="Position">
                                <Select
                                    className={styles.intrinsic}
                                    value={config.icons?.position ?? 'left'}
                                    onChange={(e) =>
                                        onChange({
                                            ...config,
                                            icons: {
                                                enabled: iconsEnabled,
                                                position: e.target.value as 'left' | 'right' | 'top'
                                            }
                                        })
                                    }
                                >
                                    <option value="left">Left</option>
                                    <option value="right">Right</option>
                                    <option value="top">Top</option>
                                </Select>
                            </Field>
                        )}
                    </Panel>

                    <Panel title="Layout" meta="Orientation and item-count limits.">
                        <div className={styles.field_row}>
                            <Field label="Orientation">
                                <Select
                                    className={styles.intrinsic}
                                    value={config.layout?.orientation ?? 'horizontal'}
                                    onChange={(e) =>
                                        onChange({
                                            ...config,
                                            layout: {
                                                ...(config.layout ?? {}),
                                                orientation: e.target.value as 'horizontal' | 'vertical'
                                            }
                                        })
                                    }
                                >
                                    <option value="horizontal">Horizontal</option>
                                    <option value="vertical">Vertical</option>
                                </Select>
                            </Field>
                            <Field label="Max items">
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    className={styles.number_input}
                                    value={config.layout?.maxItems ?? ''}
                                    placeholder="No limit"
                                    onChange={(e) =>
                                        onChange({
                                            ...config,
                                            layout: {
                                                orientation: config.layout?.orientation ?? 'horizontal',
                                                maxItems: parseOptionalCount(e.target.value)
                                            }
                                        })
                                    }
                                />
                            </Field>
                        </div>
                    </Panel>

                    <Panel title="Styling" meta="Visual rendering hints.">
                        <Field inline label="Compact mode" hint="Tighter spacing and smaller text.">
                            <Switch
                                on={config.styling?.compact ?? false}
                                onChange={(next) =>
                                    onChange({
                                        ...config,
                                        styling: { ...(config.styling ?? {}), compact: next }
                                    })
                                }
                                aria-label="Compact mode"
                            />
                        </Field>
                        <Field inline label="Show text labels">
                            <Switch
                                on={config.styling?.showLabels ?? true}
                                onChange={(next) =>
                                    onChange({
                                        ...config,
                                        styling: { ...(config.styling ?? {}), showLabels: next }
                                    })
                                }
                                aria-label="Show text labels"
                            />
                        </Field>
                    </Panel>
                </div>

                <div className={styles.config_actions}>
                    <Button variant="ghost" onClick={onReset} disabled={saving}>
                        Reset to defaults
                    </Button>
                    <Button variant="primary" onClick={onSave} loading={saving}>
                        Save configuration
                    </Button>
                </div>
            </Stack>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Modal forms                                                        */
/* ------------------------------------------------------------------ */

/** Props for the create and edit form. */
interface IMenuNodeFormProps {
    /** Whether the form creates a node or edits `initial`. */
    mode: 'create' | 'edit';
    /** The node being edited; omitted when creating. */
    initial?: IMenuNode;
    /** Nodes the Parent dropdown offers; the edited node itself is left out. */
    availableParents: IMenuNode[];
    /** User groups the Required groups switches offer. */
    availableGroups: IUserGroup[];
    /** Receives the normalized fields to save. */
    onSubmit: (data: Partial<IMenuNode>) => Promise<void>;
    /** Closes the form without saving. */
    onCancel: () => void;
}

/**
 * Turn a blank or whitespace-only text field into an omitted value, because
 * the backend's optional-string schemas reject empty strings (their regexes
 * require at least one character).
 *
 * @param value - The field's value.
 * @returns The trimmed text, or undefined when nothing is left.
 */
function blankToUndefined(value: string | undefined): string | undefined {
    return typeof value === 'string' ? (value.trim() || undefined) : value;
}

/**
 * The create and edit form for one menu node, shown in a modal.
 *
 * @param props - The mode, the node being edited, the parent and group
 *        choices, and the submit and cancel handlers.
 * @returns The form.
 */
function MenuNodeForm({ mode, initial, availableParents, availableGroups, onSubmit, onCancel }: IMenuNodeFormProps) {
    const { open: openInnerModal, close: closeInnerModal } = useModal();
    const [data, setData] = useState<Partial<IMenuNode>>({
        label: initial?.label ?? '',
        url: initial?.url ?? '',
        icon: initial?.icon ?? '',
        order: initial?.order ?? 0,
        parent: initial?.parent ?? null,
        enabled: initial?.enabled ?? true,
        hidden: initial?.hidden ?? false,
        requiresGroups: initial?.requiresGroups,
        requiresAdmin: initial?.requiresAdmin ?? false
    });
    const [saving, setSaving] = useState(false);

    /**
     * Normalize the fields and hand them to the caller.
     *
     * Gating fields are sent through as-is (including `[]` and `false`) so a
     * PATCH that clears a previously-set gate carries an explicit clear
     * signal. The backend treats empty arrays and `requiresAdmin: false` as
     * "remove this gate" and persists them via `$unset`. Sending `undefined`
     * would drop the key from the JSON payload, which the partial-update path
     * interprets as "leave this field unchanged" — preventing operators from
     * ever clearing a gate from the UI.
     *
     * @param e - The submit event, whose default page load is prevented.
     */
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const normalized: Partial<IMenuNode> = {
                ...data,
                label: typeof data.label === 'string' ? data.label.trim() : data.label,
                url: blankToUndefined(data.url),
                icon: blankToUndefined(data.icon),
                // Sent as an explicit boolean so a PATCH can move a hidden
                // node back into the menu; an omitted key means "unchanged".
                hidden: Boolean(data.hidden),
                requiresGroups: data.requiresGroups ?? [],
                requiresAdmin: Boolean(data.requiresAdmin)
            };
            await onSubmit(normalized);
        } finally {
            setSaving(false);
        }
    };

    /**
     * Add a group to the node's required groups, or remove it.
     *
     * @param groupId - The group whose switch was flipped.
     */
    const toggleGroup = (groupId: string) => {
        setData((prev) => {
            const current = prev.requiresGroups ?? [];
            const next = current.includes(groupId)
                ? current.filter((g) => g !== groupId)
                : [...current, groupId];
            return { ...prev, requiresGroups: next };
        });
    };

    /** Open the icon picker over the form and store the icon it returns. */
    const openIconPicker = () => {
        const id = openInnerModal({
            title: 'Select icon',
            size: 'lg',
            content: (
                <LazyIconPickerModal
                    selectedIcon={data.icon || undefined}
                    onSelect={(name) => {
                        setData((prev) => ({ ...prev, icon: name }));
                        closeInnerModal(id);
                    }}
                    onClose={() => closeInnerModal(id)}
                />
            )
        });
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <Field label="Label" required>
                <Input
                    value={data.label ?? ''}
                    onChange={(e) => setData({ ...data, label: e.target.value })}
                    required
                    disabled={saving}
                />
            </Field>

            <div className={styles.field_row}>
                <Field label="URL" className={styles.field_grow}>
                    <Input
                        value={data.url ?? ''}
                        onChange={(e) => setData({ ...data, url: e.target.value })}
                        placeholder="/path"
                        disabled={saving}
                    />
                </Field>
                <Field label="Order">
                    <Input
                        type="number"
                        inputMode="numeric"
                        className={styles.number_input}
                        value={data.order ?? 0}
                        onChange={(e) =>
                            setData({ ...data, order: parseInt(e.target.value, 10) || 0 })
                        }
                        disabled={saving}
                    />
                </Field>
            </div>

            <Field label="Icon" htmlFor="mn-icon">
                <div className={styles.icon_field}>
                    <Input
                        id="mn-icon"
                        className={styles.icon_field_input}
                        value={data.icon ?? ''}
                        onChange={(e) => setData({ ...data, icon: e.target.value })}
                        placeholder="Lucide icon name (e.g., Home)"
                        disabled={saving}
                    />
                    <Button type="button" variant="ghost" onClick={openIconPicker} disabled={saving}>
                        Browse
                    </Button>
                </div>
            </Field>

            <Field label="Parent">
                <Select
                    value={data.parent ?? ''}
                    onChange={(e) => setData({ ...data, parent: e.target.value || null })}
                    disabled={saving}
                >
                    <option value="">None (root level)</option>
                    {availableParents.map((p) => (
                        <option key={p._id} value={p._id ?? ''}>
                            {p.label}
                        </option>
                    ))}
                </Select>
            </Field>

            <fieldset className={styles.fieldset} disabled={saving}>
                <legend className={styles.legend}>Required groups</legend>
                {availableGroups.length === 0 ? (
                    <p className={styles.hint}>No groups defined yet.</p>
                ) : (
                    <div className={styles.group_switches}>
                        {availableGroups.map((group) => (
                            <Switch
                                key={group.id}
                                label={group.name}
                                on={(data.requiresGroups ?? []).includes(group.id)}
                                onChange={() => toggleGroup(group.id)}
                            />
                        ))}
                    </div>
                )}
                <p className={styles.hint}>
                    Visible to users in <em>any</em> selected group (OR-of-membership).
                </p>
            </fieldset>

            <Field inline label="Require admin" hint="Visible only to admins.">
                <Switch
                    on={data.requiresAdmin ?? false}
                    onChange={(next) => setData({ ...data, requiresAdmin: next })}
                    disabled={saving}
                    aria-label="Require admin"
                />
            </Field>

            <Field
                inline
                label="Enabled"
                hint="Turning this off removes the item everywhere, including its category landing page."
            >
                <Switch
                    on={data.enabled ?? true}
                    onChange={(next) => setData({ ...data, enabled: next })}
                    disabled={saving}
                    aria-label="Enabled"
                />
            </Field>

            <Field
                inline
                label="Show in menu"
                hint="Turning this off removes the item and its children from navigation only. Its category landing page and its card on the parent's landing page keep working."
            >
                <Switch
                    on={!data.hidden}
                    onChange={(next) => setData({ ...data, hidden: !next })}
                    disabled={saving}
                    aria-label="Show in menu"
                />
            </Field>

            <div className={styles.form_footer}>
                <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
                    Cancel
                </Button>
                <Button type="submit" variant="primary" loading={saving} disabled={!data.label}>
                    {mode === 'create' ? 'Create' : 'Save changes'}
                </Button>
            </div>
        </form>
    );
}

/** Props for the create-namespace form. */
interface INamespaceFormProps {
    /** Namespaces already in use, so a duplicate is refused before submitting. */
    existing: string[];
    /** Receives the cleaned namespace name. */
    onSubmit: (name: string) => void;
    /** Closes the form without switching. */
    onCancel: () => void;
}

// Mirrors the backend's NAMESPACE_REGEX in menu.controller.ts. Catching
// malformed identifiers here turns "create namespace, switch to it, every
// fetch returns 400" into an inline form error before the user commits.
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * The form that names a new namespace, shown in a modal. A duplicate or
 * malformed name is reported under the field, and Create stays disabled
 * until the name is usable.
 *
 * @param props - The names in use and the submit and cancel handlers.
 * @returns The form.
 */
function NamespaceForm({ existing, onSubmit, onCancel }: INamespaceFormProps) {
    const [name, setName] = useState('');
    // Auto-lowercase so the common typo (uppercase first letter) doesn't
    // produce a confusing format error — the backend rejects uppercase.
    const trimmed = name.trim().toLowerCase();
    const isEmpty = trimmed.length === 0;
    const isDuplicate = existing.includes(trimmed);
    const isMalformed = !isEmpty && !NAMESPACE_PATTERN.test(trimmed);
    const invalid = isEmpty || isDuplicate || isMalformed;
    const error = isDuplicate
        ? 'Namespace already exists.'
        : isMalformed
            ? 'Must start with a letter and contain only lowercase letters, digits, or hyphens.'
            : undefined;

    /**
     * Hand the cleaned name to the caller when it is usable.
     *
     * @param e - The submit event, whose default page load is prevented.
     */
    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (!invalid) onSubmit(trimmed);
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <Field
                label="Namespace name"
                hint="Lowercase letters, digits, hyphens; must start with a letter; max 64 chars."
                error={error}
            >
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., footer, mobile, admin-sidebar"
                    autoFocus
                    required
                    invalid={error !== undefined}
                />
            </Field>
            <div className={styles.form_footer}>
                <Button type="button" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={invalid}>
                    Create
                </Button>
            </div>
        </form>
    );
}
