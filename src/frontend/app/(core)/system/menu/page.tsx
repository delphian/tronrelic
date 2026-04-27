'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type { IMenuNamespaceConfig, IMenuNode, IMenuTree, IUserGroup } from '@/types';
import { UserIdentityState } from '@/types';

import { Page, Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { Switch } from '../../../../components/ui/Switch';
import { Tbody, Td, Th, Thead, Tr, Table } from '../../../../components/ui/Table';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useToast } from '../../../../components/ui/ToastProvider';
import { LazyIconPickerModal } from '../../../../components/ui/IconPickerModal';
import { useSystemAuth } from '../../../../features/system';
import { cn } from '../../../../lib/cn';

import styles from './menu.module.scss';

type Tab = 'items' | 'config';

interface FlatNode {
    node: IMenuNode;
    depth: number;
    parentLabel: string | null;
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
 */
function flattenTree(nodes: IMenuNode[]): FlatNode[] {
    const knownIds = new Set<string>();
    for (const node of nodes) {
        if (node._id) knownIds.add(node._id);
    }

    const byParent = new Map<string | null, IMenuNode[]>();
    for (const node of nodes) {
        const key = node.parent && knownIds.has(node.parent) ? node.parent : null;
        const bucket = byParent.get(key) ?? [];
        bucket.push(node);
        byParent.set(key, bucket);
    }
    for (const bucket of byParent.values()) {
        bucket.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    }

    const labelById = new Map<string, string>();
    for (const node of nodes) {
        if (node._id) labelById.set(node._id, node.label);
    }

    const out: FlatNode[] = [];
    const walk = (parentId: string | null, depth: number) => {
        const bucket = byParent.get(parentId) ?? [];
        for (const node of bucket) {
            out.push({
                node,
                depth,
                parentLabel: node.parent ? labelById.get(node.parent) ?? null : null
            });
            if (node._id) walk(node._id, depth + 1);
        }
    };
    walk(null, 0);
    return out;
}

/**
 * Menu administration page.
 *
 * Compact, table-driven view for managing menu nodes and namespace
 * configuration. Items render as a single flat <Table> with depth chevrons;
 * create/edit happens in modals, deletes confirm via modal, success/error
 * surface via toasts.
 *
 * Lives behind /system, which is admin-token-gated by SystemAuthGate. Token
 * only exists in localStorage on the client, so the page fetches after mount
 * (same convention as /system/plugins, /system/theme, /system/users).
 */
export default function MenuAdminPage() {
    const { token } = useSystemAuth();
    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    const [activeTab, setActiveTab] = useState<Tab>('items');
    const [namespaces, setNamespaces] = useState<string[]>([]);
    const [activeNamespace, setActiveNamespace] = useState<string>('main');

    const [menuTree, setMenuTree] = useState<IMenuTree | null>(null);
    const [config, setConfig] = useState<IMenuNamespaceConfig | null>(null);
    const [loading, setLoading] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
    // Admin-defined groups for the gating fieldset multi-select. Populated
    // once on mount; group definition changes are infrequent enough that we
    // don't subscribe to live updates here.
    const [availableGroups, setAvailableGroups] = useState<IUserGroup[]>([]);

    const authHeaders = useMemo<HeadersInit>(
        () => ({ 'X-Admin-Token': token || '' }),
        [token]
    );

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

    const notifySuccess = useCallback(
        (title: string) => pushToast({ tone: 'success', title }),
        [pushToast]
    );

    const fetchTree = useCallback(
        async (namespace: string) => {
            const res = await fetch(`/api/menu?namespace=${encodeURIComponent(namespace)}`, {
                headers: authHeaders
            });
            if (!res.ok) throw new Error('Failed to load menu tree');
            const data = await res.json();
            return data.tree as IMenuTree;
        },
        [authHeaders]
    );

    const fetchConfig = useCallback(
        async (namespace: string) => {
            const res = await fetch(
                `/api/menu/namespace/${encodeURIComponent(namespace)}/config`,
                { headers: authHeaders }
            );
            if (!res.ok) throw new Error('Failed to load namespace configuration');
            const data = await res.json();
            return data.config as IMenuNamespaceConfig;
        },
        [authHeaders]
    );

    /* Initial namespace list. */
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/menu/namespaces', { headers: authHeaders });
                if (!res.ok) throw new Error('Failed to load namespaces');
                const data = await res.json();
                const list: string[] = data.namespaces ?? [];
                if (cancelled) return;
                setNamespaces(list);
                if (list.length > 0 && !list.includes(activeNamespace)) {
                    setActiveNamespace(list[0]);
                }
            } catch (err) {
                if (!cancelled) notifyError('Could not load namespaces', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [authHeaders, notifyError]); // intentionally omits activeNamespace

    /* Available groups for the gating multi-select. Fetched once; group
     * definition changes are operator-driven and infrequent. Errors are
     * surfaced as a toast but don't block the page — operators can still
     * edit nodes whose gating fields don't depend on group selection. */
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/admin/users/groups', { headers: authHeaders });
                if (!res.ok) throw new Error('Failed to load user groups');
                const data = await res.json();
                if (cancelled) return;
                setAvailableGroups((data.groups ?? []) as IUserGroup[]);
            } catch (err) {
                if (!cancelled) notifyError('Could not load user groups', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [authHeaders, notifyError]);

    /* Tree + config for the active namespace. */
    useEffect(() => {
        if (!activeNamespace) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const [tree, cfg] = await Promise.all([
                    fetchTree(activeNamespace),
                    fetchConfig(activeNamespace)
                ]);
                if (cancelled) return;
                setMenuTree(tree);
                setConfig(cfg);
            } catch (err) {
                if (!cancelled) notifyError('Could not load namespace data', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [activeNamespace, fetchTree, fetchConfig, notifyError]);

    const reloadTree = useCallback(async () => {
        try {
            const tree = await fetchTree(activeNamespace);
            setMenuTree(tree);
        } catch (err) {
            notifyError('Could not refresh menu tree', err);
        }
    }, [activeNamespace, fetchTree, notifyError]);

    const handleCreate = useCallback(
        async (data: Partial<IMenuNode>) => {
            const res = await fetch('/api/menu', {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, namespace: activeNamespace })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Failed to create menu item');
            }
        },
        [activeNamespace, authHeaders]
    );

    const handleUpdate = useCallback(
        async (id: string, updates: Partial<IMenuNode>) => {
            const res = await fetch(`/api/menu/${id}`, {
                method: 'PATCH',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Failed to update menu item');
            }
        },
        [authHeaders]
    );

    const handleDelete = useCallback(
        async (id: string) => {
            const res = await fetch(`/api/menu/${id}`, {
                method: 'DELETE',
                headers: authHeaders
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Failed to delete menu item');
            }
        },
        [authHeaders]
    );

    const toggleEnabled = useCallback(
        async (node: IMenuNode, next: boolean) => {
            if (!node._id) return;
            setBusyNodeId(node._id);
            try {
                await handleUpdate(node._id, { enabled: next });
                await reloadTree();
                notifySuccess(next ? 'Menu item enabled' : 'Menu item disabled');
            } catch (err) {
                notifyError('Could not update menu item', err);
            } finally {
                setBusyNodeId(null);
            }
        },
        [handleUpdate, notifyError, notifySuccess, reloadTree]
    );

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

    const openDeleteModal = useCallback(
        (node: IMenuNode) => {
            if (!node._id) return;
            const id = openModal({
                title: 'Delete menu item',
                size: 'sm',
                content: (
                    <ConfirmDialog
                        label={node.label}
                        onCancel={() => closeModal(id)}
                        onConfirm={async () => {
                            try {
                                await handleDelete(node._id!);
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
        },
        [closeModal, handleDelete, notifyError, notifySuccess, openModal, reloadTree]
    );

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

    const handleSaveConfig = useCallback(async () => {
        if (!config || !activeNamespace) return;
        setSavingConfig(true);
        try {
            const res = await fetch(
                `/api/menu/namespace/${encodeURIComponent(activeNamespace)}/config`,
                {
                    method: 'PUT',
                    headers: { ...authHeaders, 'Content-Type': 'application/json' },
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
    }, [activeNamespace, authHeaders, config, notifyError, notifySuccess]);

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
                                { method: 'DELETE', headers: authHeaders }
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
    }, [activeNamespace, authHeaders, closeModal, fetchConfig, notifyError, notifySuccess, openModal]);

    const flatNodes = useMemo(
        () => (menuTree ? flattenTree(menuTree.all) : []),
        [menuTree]
    );

    return (
        <Page>
            <div className={styles.container}>
                <Stack gap="md">
                    <div className={styles.toolbar}>
                        <div className={styles.toolbar_group}>
                            <span className={styles.toolbar_label}>Namespace</span>
                            <select
                                className={styles.select}
                                value={activeNamespace}
                                onChange={(e) => setActiveNamespace(e.target.value)}
                                disabled={loading}
                                aria-label="Active namespace"
                            >
                                {namespaces.length === 0 && (
                                    <option value={activeNamespace}>{activeNamespace}</option>
                                )}
                                {namespaces.map((ns) => (
                                    <option key={ns} value={ns}>
                                        {ns}
                                    </option>
                                ))}
                            </select>
                            <IconButton
                                size="sm"
                                variant="primary"
                                aria-label="Create namespace"
                                onClick={openNamespaceModal}
                            >
                                <Plus size={16} />
                            </IconButton>
                        </div>

                        <div className="segmented-control" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeTab === 'items'}
                                className={activeTab === 'items' ? 'is-active' : undefined}
                                onClick={() => setActiveTab('items')}
                            >
                                Items
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeTab === 'config'}
                                className={activeTab === 'config' ? 'is-active' : undefined}
                                onClick={() => setActiveTab('config')}
                            >
                                Configuration
                            </button>
                        </div>
                    </div>

                    {loading && <div className={styles.loading}>Loading…</div>}

                    {!loading && activeTab === 'items' && (
                        <ItemsTab
                            flatNodes={flatNodes}
                            busyNodeId={busyNodeId}
                            onCreate={() => openItemModal('create')}
                            onEdit={(node) => openItemModal('edit', node)}
                            onDelete={openDeleteModal}
                            onToggleEnabled={toggleEnabled}
                        />
                    )}

                    {!loading && activeTab === 'config' && config && (
                        <ConfigTab
                            config={config}
                            saving={savingConfig}
                            onChange={setConfig}
                            onSave={handleSaveConfig}
                            onReset={handleResetConfig}
                        />
                    )}
                </Stack>
            </div>
        </Page>
    );
}

/* ------------------------------------------------------------------ */
/* Items tab                                                          */
/* ------------------------------------------------------------------ */

interface ItemsTabProps {
    flatNodes: FlatNode[];
    busyNodeId: string | null;
    onCreate: () => void;
    onEdit: (node: IMenuNode) => void;
    onDelete: (node: IMenuNode) => void;
    onToggleEnabled: (node: IMenuNode, next: boolean) => void;
}

function ItemsTab({ flatNodes, busyNodeId, onCreate, onEdit, onDelete, onToggleEnabled }: ItemsTabProps) {
    return (
        <Stack gap="sm">
            <div className={styles.items_header}>
                <span className={styles.items_count}>
                    {flatNodes.length} {flatNodes.length === 1 ? 'item' : 'items'}
                </span>
                <Button size="sm" icon={<Plus size={14} />} onClick={onCreate}>
                    Create item
                </Button>
            </div>

            {flatNodes.length === 0 ? (
                <div className={styles.empty_state}>
                    No menu items yet. Create the first item to get started.
                </div>
            ) : (
                <Table variant="compact">
                    <Thead>
                        <Tr>
                            <Th>Label</Th>
                            <Th>URL</Th>
                            <Th width="shrink">Order</Th>
                            <Th width="shrink">Parent</Th>
                            <Th width="shrink">Enabled</Th>
                            <Th width="shrink">Actions</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {flatNodes.map(({ node, depth, parentLabel }) => (
                            <Tr key={node._id ?? `${node.label}-${node.order}`}>
                                <Td>
                                    <span
                                        className={styles.label_cell}
                                        style={{ paddingLeft: `${depth * 16}px` }}
                                    >
                                        {depth > 0 && <ChevronRight size={14} className={styles.depth_chevron} />}
                                        {node.icon && <span className={styles.icon_pill}>{node.icon}</span>}
                                        <span className={styles.label_text}>{node.label}</span>
                                    </span>
                                </Td>
                                <Td muted className={styles.url_cell}>
                                    {node.url || '—'}
                                </Td>
                                <Td>{node.order}</Td>
                                <Td muted>{parentLabel ?? '—'}</Td>
                                <Td>
                                    <Switch
                                        size="sm"
                                        on={node.enabled}
                                        onChange={(next) => onToggleEnabled(node, next)}
                                        disabled={busyNodeId === node._id}
                                        aria-label={`${node.enabled ? 'Disable' : 'Enable'} ${node.label}`}
                                    />
                                </Td>
                                <Td>
                                    <div className={styles.row_actions}>
                                        <IconButton
                                            size="sm"
                                            variant="primary"
                                            aria-label={`Edit ${node.label}`}
                                            onClick={() => onEdit(node)}
                                        >
                                            <Pencil size={14} />
                                        </IconButton>
                                        <IconButton
                                            size="sm"
                                            variant="danger"
                                            aria-label={`Delete ${node.label}`}
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
        </Stack>
    );
}

/* ------------------------------------------------------------------ */
/* Configuration tab                                                  */
/* ------------------------------------------------------------------ */

interface ConfigTabProps {
    config: IMenuNamespaceConfig;
    saving: boolean;
    onChange: (next: IMenuNamespaceConfig) => void;
    onSave: () => void;
    onReset: () => void;
}

function ConfigTab({ config, saving, onChange, onSave, onReset }: ConfigTabProps) {
    return (
        <Stack gap="md">
            <ConfigGroup
                title="Overflow"
                subtitle="Move items past the visible width into a “More” dropdown using the Priority+ pattern."
            >
                <label className={styles.inline_toggle}>
                    <Switch
                        size="sm"
                        on={config.overflow?.enabled ?? true}
                        onChange={(next) =>
                            onChange({
                                ...config,
                                overflow: { ...(config.overflow ?? {}), enabled: next }
                            })
                        }
                        aria-label="Enable overflow handling"
                    />
                    <span>Enable overflow handling</span>
                </label>

                {(config.overflow?.enabled ?? true) && (
                    <div className={styles.field}>
                        <label htmlFor="collapseAtCount">Collapse at count</label>
                        <Input
                            id="collapseAtCount"
                            type="number"
                            min={1}
                            max={20}
                            value={config.overflow?.collapseAtCount ?? ''}
                            placeholder="No minimum"
                            onChange={(e) =>
                                onChange({
                                    ...config,
                                    overflow: {
                                        enabled: config.overflow?.enabled ?? true,
                                        collapseAtCount: e.target.value
                                            ? parseInt(e.target.value, 10)
                                            : undefined
                                    }
                                })
                            }
                        />
                        <span className={styles.field_hint}>
                            Collapse all items into “More” once visible count drops below this
                            threshold (avoids orphaned items).
                        </span>
                    </div>
                )}
            </ConfigGroup>

            <ConfigGroup title="Icons" subtitle="Show or hide icons next to labels.">
                <label className={styles.inline_toggle}>
                    <Switch
                        size="sm"
                        on={config.icons?.enabled ?? true}
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
                    <span>Display icons</span>
                </label>

                {(config.icons?.enabled ?? true) && (
                    <div className={styles.field}>
                        <label htmlFor="iconPosition">Position</label>
                        <select
                            id="iconPosition"
                            className={cn(styles.select, styles.select_full)}
                            value={config.icons?.position ?? 'left'}
                            onChange={(e) =>
                                onChange({
                                    ...config,
                                    icons: {
                                        enabled: config.icons?.enabled ?? true,
                                        position: e.target.value as 'left' | 'right' | 'top'
                                    }
                                })
                            }
                        >
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="top">Top</option>
                        </select>
                    </div>
                )}
            </ConfigGroup>

            <ConfigGroup title="Layout" subtitle="Orientation and item-count limits.">
                <div className={styles.field_row}>
                    <div className={styles.field}>
                        <label htmlFor="orientation">Orientation</label>
                        <select
                            id="orientation"
                            className={cn(styles.select, styles.select_full)}
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
                        </select>
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="maxItems">Max items</label>
                        <Input
                            id="maxItems"
                            type="number"
                            min={1}
                            value={config.layout?.maxItems ?? ''}
                            placeholder="No limit"
                            onChange={(e) =>
                                onChange({
                                    ...config,
                                    layout: {
                                        orientation: config.layout?.orientation ?? 'horizontal',
                                        maxItems: e.target.value ? parseInt(e.target.value, 10) : undefined
                                    }
                                })
                            }
                        />
                    </div>
                </div>
            </ConfigGroup>

            <ConfigGroup title="Styling" subtitle="Visual rendering hints.">
                <label className={styles.inline_toggle}>
                    <Switch
                        size="sm"
                        on={config.styling?.compact ?? false}
                        onChange={(next) =>
                            onChange({
                                ...config,
                                styling: { ...(config.styling ?? {}), compact: next }
                            })
                        }
                        aria-label="Compact mode"
                    />
                    <span>Compact mode (tighter spacing, smaller text)</span>
                </label>
                <label className={styles.inline_toggle}>
                    <Switch
                        size="sm"
                        on={config.styling?.showLabels ?? true}
                        onChange={(next) =>
                            onChange({
                                ...config,
                                styling: { ...(config.styling ?? {}), showLabels: next }
                            })
                        }
                        aria-label="Show text labels"
                    />
                    <span>Show text labels</span>
                </label>
            </ConfigGroup>

            <div className={styles.config_actions}>
                <Button variant="ghost" onClick={onReset} disabled={saving}>
                    Reset to defaults
                </Button>
                <Button variant="primary" onClick={onSave} loading={saving}>
                    Save configuration
                </Button>
            </div>
        </Stack>
    );
}

interface ConfigGroupProps {
    title: string;
    subtitle?: string;
    children: ReactNode;
}

function ConfigGroup({ title, subtitle, children }: ConfigGroupProps) {
    return (
        <section className={styles.config_group}>
            <header className={styles.config_group_header}>
                <h3 className={styles.config_group_title}>{title}</h3>
                {subtitle && <p className={styles.config_group_subtitle}>{subtitle}</p>}
            </header>
            {children}
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* Modal forms                                                        */
/* ------------------------------------------------------------------ */

interface MenuNodeFormProps {
    mode: 'create' | 'edit';
    initial?: IMenuNode;
    availableParents: IMenuNode[];
    availableGroups: IUserGroup[];
    onSubmit: (data: Partial<IMenuNode>) => Promise<void>;
    onCancel: () => void;
}

const ALL_IDENTITY_STATES: UserIdentityState[] = [
    UserIdentityState.Anonymous,
    UserIdentityState.Registered,
    UserIdentityState.Verified
];

const IDENTITY_STATE_LABELS: Record<UserIdentityState, string> = {
    [UserIdentityState.Anonymous]: 'Anonymous',
    [UserIdentityState.Registered]: 'Registered',
    [UserIdentityState.Verified]: 'Verified'
};

function MenuNodeForm({ mode, initial, availableParents, availableGroups, onSubmit, onCancel }: MenuNodeFormProps) {
    const { open: openInnerModal, close: closeInnerModal } = useModal();
    const [data, setData] = useState<Partial<IMenuNode>>({
        label: initial?.label ?? '',
        url: initial?.url ?? '',
        icon: initial?.icon ?? '',
        order: initial?.order ?? 0,
        parent: initial?.parent ?? null,
        enabled: initial?.enabled ?? true,
        allowedIdentityStates: initial?.allowedIdentityStates,
        requiresGroups: initial?.requiresGroups,
        requiresAdmin: initial?.requiresAdmin ?? false
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            // Inputs return '' when empty, but the backend's optional-string
            // schemas reject empty strings (their regexes require >= 1 char).
            // Trim and coerce blank optionals to undefined so unset fields
            // serialize as omitted rather than failing validation.
            const blankToUndefined = (v: unknown) =>
                typeof v === 'string' ? (v.trim() || undefined) : v;

            // Gating fields are sent through as-is (including `[]` and
            // `false`) so a PATCH that clears a previously-set gate carries
            // an explicit clear signal. The backend treats empty arrays and
            // `requiresAdmin: false` as "remove this gate" and persists them
            // via `$unset`. Sending `undefined` would drop the key from the
            // JSON payload, which the partial-update path interprets as
            // "leave this field unchanged" — preventing operators from ever
            // clearing a gate from the UI.
            const states = data.allowedIdentityStates ?? [];
            // All three states checked is semantically identical to no gate;
            // collapse to an empty array so the persist path unsets the
            // field rather than storing a tautological full set.
            const normalizedStates =
                states.length === ALL_IDENTITY_STATES.length ? [] : states;

            const normalized: Partial<IMenuNode> = {
                ...data,
                label: typeof data.label === 'string' ? data.label.trim() : data.label,
                url: blankToUndefined(data.url) as string | undefined,
                icon: blankToUndefined(data.icon) as string | undefined,
                allowedIdentityStates: normalizedStates,
                requiresGroups: data.requiresGroups ?? [],
                requiresAdmin: Boolean(data.requiresAdmin)
            };
            await onSubmit(normalized);
        } finally {
            setSaving(false);
        }
    };

    const toggleIdentityState = (state: UserIdentityState) => {
        setData((prev) => {
            const current = prev.allowedIdentityStates ?? [];
            const next = current.includes(state)
                ? current.filter((s) => s !== state)
                : [...current, state];
            return { ...prev, allowedIdentityStates: next };
        });
    };

    const toggleGroup = (groupId: string) => {
        setData((prev) => {
            const current = prev.requiresGroups ?? [];
            const next = current.includes(groupId)
                ? current.filter((g) => g !== groupId)
                : [...current, groupId];
            return { ...prev, requiresGroups: next };
        });
    };

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
            <div className={styles.field}>
                <label htmlFor="mn-label">
                    Label <span className={styles.field_required}>*</span>
                </label>
                <Input
                    id="mn-label"
                    value={data.label ?? ''}
                    onChange={(e) => setData({ ...data, label: e.target.value })}
                    required
                    disabled={saving}
                />
            </div>

            <div className={styles.field_row}>
                <div className={styles.field}>
                    <label htmlFor="mn-url">URL</label>
                    <Input
                        id="mn-url"
                        value={data.url ?? ''}
                        onChange={(e) => setData({ ...data, url: e.target.value })}
                        placeholder="/path"
                        disabled={saving}
                    />
                </div>
                <div className={styles.field}>
                    <label htmlFor="mn-order">Order</label>
                    <Input
                        id="mn-order"
                        type="number"
                        value={data.order ?? 0}
                        onChange={(e) =>
                            setData({ ...data, order: parseInt(e.target.value, 10) || 0 })
                        }
                        disabled={saving}
                    />
                </div>
            </div>

            <div className={styles.field}>
                <span className={styles.field_label}>Icon</span>
                <div className={styles.icon_field}>
                    <Input
                        className={styles.icon_field_input}
                        value={data.icon ?? ''}
                        onChange={(e) => setData({ ...data, icon: e.target.value })}
                        placeholder="Lucide icon name (e.g., Home)"
                        disabled={saving}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={openIconPicker} disabled={saving}>
                        Browse
                    </Button>
                </div>
            </div>

            <div className={styles.field}>
                <label htmlFor="mn-parent">Parent</label>
                <select
                    id="mn-parent"
                    className={cn(styles.select, styles.select_full)}
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
                </select>
            </div>

            <fieldset className={styles.field} disabled={saving}>
                <legend className={styles.field_label}>Visibility</legend>

                <div className={styles.field}>
                    <span className={styles.field_label}>Identity states</span>
                    {ALL_IDENTITY_STATES.map((state) => {
                        const checked = (data.allowedIdentityStates ?? []).includes(state);
                        const inputId = `mn-state-${state}`;
                        return (
                            <label key={state} htmlFor={inputId} className={styles.inline_toggle}>
                                <input
                                    id={inputId}
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleIdentityState(state)}
                                />
                                <span>{IDENTITY_STATE_LABELS[state]}</span>
                            </label>
                        );
                    })}
                    <p className={styles.field_hint}>
                        Leave all unchecked or all checked for "no restriction" — both
                        normalize to no gate at save time.
                    </p>
                </div>

                <div className={styles.field}>
                    <span className={styles.field_label}>Required groups</span>
                    {availableGroups.length === 0 ? (
                        <p className={styles.field_hint}>No groups defined yet.</p>
                    ) : (
                        availableGroups.map((group) => {
                            const checked = (data.requiresGroups ?? []).includes(group.id);
                            const inputId = `mn-group-${group.id}`;
                            return (
                                <label key={group.id} htmlFor={inputId} className={styles.inline_toggle}>
                                    <input
                                        id={inputId}
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleGroup(group.id)}
                                    />
                                    <span>{group.name}</span>
                                </label>
                            );
                        })
                    )}
                    <p className={styles.field_hint}>
                        Visible to users in <em>any</em> selected group (OR-of-membership).
                    </p>
                </div>

                <label className={styles.inline_toggle}>
                    <Switch
                        size="sm"
                        on={data.requiresAdmin ?? false}
                        onChange={(next) => setData({ ...data, requiresAdmin: next })}
                        disabled={saving}
                        aria-label="Require admin"
                    />
                    <span>Require admin</span>
                </label>
            </fieldset>

            <label className={styles.inline_toggle}>
                <Switch
                    size="sm"
                    on={data.enabled ?? true}
                    onChange={(next) => setData({ ...data, enabled: next })}
                    disabled={saving}
                    aria-label="Enabled"
                />
                <span>Enabled</span>
            </label>

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

interface NamespaceFormProps {
    existing: string[];
    onSubmit: (name: string) => void;
    onCancel: () => void;
}

// Mirrors the backend's NAMESPACE_REGEX in menu.controller.ts. Catching
// malformed identifiers here turns "create namespace, switch to it, every
// fetch returns 400" into an inline form error before the user commits.
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function NamespaceForm({ existing, onSubmit, onCancel }: NamespaceFormProps) {
    const [name, setName] = useState('');
    // Auto-lowercase so the common typo (uppercase first letter) doesn't
    // produce a confusing format error — the backend rejects uppercase.
    const trimmed = name.trim().toLowerCase();
    const isEmpty = trimmed.length === 0;
    const isDuplicate = existing.includes(trimmed);
    const isMalformed = !isEmpty && !NAMESPACE_PATTERN.test(trimmed);
    const invalid = isEmpty || isDuplicate || isMalformed;

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (invalid) return;
        onSubmit(trimmed);
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
                <label htmlFor="ns-name">Namespace name</label>
                <Input
                    id="ns-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., footer, mobile, admin-sidebar"
                    autoFocus
                    required
                />
                <span className={styles.field_hint}>
                    Lowercase letters, digits, hyphens; must start with a letter; max 64 chars.
                </span>
                {isDuplicate && (
                    <Badge tone="warning">Namespace already exists</Badge>
                )}
                {isMalformed && (
                    <Badge tone="warning">
                        Must start with a letter and contain only lowercase letters, digits, or hyphens
                    </Badge>
                )}
            </div>
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

interface ConfirmDialogProps {
    label: string;
    message?: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void> | void;
    onCancel: () => void;
}

function ConfirmDialog({
    label,
    message,
    confirmLabel = 'Delete',
    onConfirm,
    onCancel
}: ConfirmDialogProps) {
    const [working, setWorking] = useState(false);
    const handleConfirm = async () => {
        setWorking(true);
        try {
            await onConfirm();
        } finally {
            setWorking(false);
        }
    };

    return (
        <div className={styles.confirm}>
            <div className={styles.confirm_message}>
                <AlertTriangle size={20} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
                <span>
                    {message ?? (
                        <>
                            Delete <strong>{label}</strong>? This action cannot be undone.
                        </>
                    )}
                </span>
            </div>
            <div className={styles.confirm_actions}>
                <Button variant="ghost" onClick={onCancel} disabled={working}>
                    Cancel
                </Button>
                <Button variant="danger" onClick={handleConfirm} loading={working}>
                    {confirmLabel}
                </Button>
            </div>
        </div>
    );
}
