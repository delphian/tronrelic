'use client';

import { useState, useEffect } from 'react';
import type { IMenuNamespaceConfig, IMenuNode, IMenuTree } from '@tronrelic/types';
import styles from './menu.module.css';

type Tab = 'items' | 'config';

/**
 * Menu system administration page.
 *
 * Provides centralized management interface for:
 * - Creating, editing, and deleting menu items
 * - Reordering menu items and managing hierarchy
 * - Configuring namespace-level UI settings (hamburger menu, icons, layout)
 * - Managing responsive behavior and display preferences
 *
 * Configuration changes update immediately via WebSocket to all connected clients.
 */
export default function MenuAdminPage() {
    const [activeTab, setActiveTab] = useState<Tab>('items');
    const [namespaces, setNamespaces] = useState<string[]>([]);
    const [selectedNamespace, setSelectedNamespace] = useState<string>('main');
    const [customNamespace, setCustomNamespace] = useState<string>('');
    const [useCustom, setUseCustom] = useState<boolean>(false);

    // Menu items state
    const [menuTree, setMenuTree] = useState<IMenuTree | null>(null);
    const [editingNode, setEditingNode] = useState<IMenuNode | null>(null);
    const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

    // Namespace config state
    const [config, setConfig] = useState<IMenuNamespaceConfig | null>(null);

    // UI state
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Get the active namespace (custom or selected)
    const activeNamespace = useCustom ? customNamespace.trim() : selectedNamespace;

    // Fetch available namespaces on mount
    useEffect(() => {
        async function loadNamespaces() {
            try {
                const adminToken = localStorage.getItem('admin_token');
                const res = await fetch('/api/menu/namespaces', {
                    headers: {
                        'X-Admin-Token': adminToken || ''
                    }
                });

                if (!res.ok) {
                    throw new Error('Failed to load namespaces');
                }

                const data = await res.json();
                setNamespaces(data.namespaces || []);

                // Select first namespace if none selected
                if (data.namespaces.length > 0 && !selectedNamespace) {
                    setSelectedNamespace(data.namespaces[0]);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load namespaces');
            }
        }

        void loadNamespaces();
    }, []);

    // Load menu tree and config when namespace changes
    useEffect(() => {
        if (!activeNamespace) return;

        async function loadData() {
            setLoading(true);
            setError(null);

            try {
                const adminToken = localStorage.getItem('admin_token');

                // Load menu tree
                const treeRes = await fetch(`/api/menu?namespace=${activeNamespace}`, {
                    headers: {
                        'X-Admin-Token': adminToken || ''
                    }
                });

                if (!treeRes.ok) {
                    throw new Error('Failed to load menu tree');
                }

                const treeData = await treeRes.json();
                setMenuTree(treeData.tree);

                // Load namespace config
                const configRes = await fetch(`/api/menu/namespace/${activeNamespace}/config`, {
                    headers: {
                        'X-Admin-Token': adminToken || ''
                    }
                });

                if (!configRes.ok) {
                    throw new Error('Failed to load configuration');
                }

                const configData = await configRes.json();
                setConfig(configData.config);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load data');
            } finally {
                setLoading(false);
            }
        }

        void loadData();
    }, [activeNamespace]);

    /**
     * Create a new menu item.
     */
    async function handleCreateNode(nodeData: Partial<IMenuNode>) {
        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const adminToken = localStorage.getItem('admin_token');
            const res = await fetch('/api/menu', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': adminToken || ''
                },
                body: JSON.stringify({
                    ...nodeData,
                    namespace: activeNamespace
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create menu item');
            }

            setSuccess('Menu item created successfully');
            setShowCreateForm(false);

            // Reload menu tree
            await reloadMenuTree();

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create menu item');
        } finally {
            setSaving(false);
        }
    }

    /**
     * Update an existing menu item.
     */
    async function handleUpdateNode(id: string, updates: Partial<IMenuNode>) {
        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const adminToken = localStorage.getItem('admin_token');
            const res = await fetch(`/api/menu/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': adminToken || ''
                },
                body: JSON.stringify(updates)
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to update menu item');
            }

            setSuccess('Menu item updated successfully');
            setEditingNode(null);

            // Reload menu tree
            await reloadMenuTree();

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update menu item');
        } finally {
            setSaving(false);
        }
    }

    /**
     * Delete a menu item.
     */
    async function handleDeleteNode(id: string, label: string) {
        if (!confirm(`Delete menu item "${label}"? This action cannot be undone.`)) {
            return;
        }

        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const adminToken = localStorage.getItem('admin_token');
            const res = await fetch(`/api/menu/${id}`, {
                method: 'DELETE',
                headers: {
                    'X-Admin-Token': adminToken || ''
                }
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to delete menu item');
            }

            setSuccess('Menu item deleted successfully');

            // Reload menu tree
            await reloadMenuTree();

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete menu item');
        } finally {
            setSaving(false);
        }
    }

    /**
     * Reload the menu tree from the server.
     */
    async function reloadMenuTree() {
        try {
            const adminToken = localStorage.getItem('admin_token');
            const res = await fetch(`/api/menu?namespace=${activeNamespace}`, {
                headers: {
                    'X-Admin-Token': adminToken || ''
                }
            });

            if (!res.ok) {
                throw new Error('Failed to reload menu tree');
            }

            const data = await res.json();
            setMenuTree(data.tree);
        } catch (err) {
            console.error('Failed to reload menu tree:', err);
        }
    }

    /**
     * Save namespace configuration changes.
     */
    async function handleSaveConfig() {
        if (!config || !activeNamespace) return;

        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const adminToken = localStorage.getItem('admin_token');
            const res = await fetch(`/api/menu/namespace/${activeNamespace}/config`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': adminToken || ''
                },
                body: JSON.stringify({
                    hamburgerMenu: config.hamburgerMenu,
                    icons: config.icons,
                    layout: config.layout,
                    styling: config.styling
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to save configuration');
            }

            const data = await res.json();
            setConfig(data.config);
            setSuccess(`Configuration saved successfully for '${activeNamespace}' namespace`);

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save configuration');
        } finally {
            setSaving(false);
        }
    }

    /**
     * Reset namespace configuration to defaults.
     */
    async function handleResetConfig() {
        if (!activeNamespace) return;

        if (!confirm(`Reset '${activeNamespace}' configuration to defaults?`)) {
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const adminToken = localStorage.getItem('admin_token');
            const res = await fetch(`/api/menu/namespace/${activeNamespace}/config`, {
                method: 'DELETE',
                headers: {
                    'X-Admin-Token': adminToken || ''
                }
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to reset configuration');
            }

            // Reload config (will return defaults)
            const getRes = await fetch(`/api/menu/namespace/${activeNamespace}/config`, {
                headers: {
                    'X-Admin-Token': adminToken || ''
                }
            });

            const data = await getRes.json();
            setConfig(data.config);
            setSuccess(`Configuration reset to defaults for '${activeNamespace}' namespace`);

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to reset configuration');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1>Menu Administration</h1>
                <p>Manage menu items and configure namespace rendering preferences</p>
            </header>

            {error && (
                <div className={styles.error}>
                    <strong>Error:</strong> {error}
                </div>
            )}

            {success && (
                <div className={styles.success}>
                    <strong>Success:</strong> {success}
                </div>
            )}

            {/* Namespace Selector */}
            <section className={styles.section}>
                <h2>Select or Create Namespace</h2>
                <p className={styles.sectionDesc}>
                    Choose an existing namespace or create a new one by entering a custom name.
                </p>

                <div className={styles.namespaceSelector}>
                    <label className={styles.radioLabel}>
                        <input
                            type="radio"
                            checked={!useCustom}
                            onChange={() => setUseCustom(false)}
                            disabled={loading}
                        />
                        <span>Select existing namespace</span>
                    </label>

                    {!useCustom && (
                        <select
                            value={selectedNamespace}
                            onChange={(e) => setSelectedNamespace(e.target.value)}
                            className={styles.select}
                            disabled={loading}
                        >
                            {namespaces.map((ns) => (
                                <option key={ns} value={ns}>
                                    {ns}
                                </option>
                            ))}
                        </select>
                    )}

                    <label className={styles.radioLabel}>
                        <input
                            type="radio"
                            checked={useCustom}
                            onChange={() => setUseCustom(true)}
                            disabled={loading}
                        />
                        <span>Create new namespace</span>
                    </label>

                    {useCustom && (
                        <div className={styles.field}>
                            <input
                                type="text"
                                value={customNamespace}
                                onChange={(e) => setCustomNamespace(e.target.value)}
                                placeholder="Enter namespace name (e.g., footer, mobile)"
                                className={styles.input}
                                disabled={loading}
                            />
                            <span className={styles.hint}>
                                Use lowercase, hyphens allowed (e.g., 'footer', 'admin-sidebar', 'mobile-nav')
                            </span>
                        </div>
                    )}
                </div>

                {activeNamespace && (
                    <div className={styles.activeNamespace}>
                        <strong>Active Namespace:</strong> {activeNamespace}
                    </div>
                )}
            </section>

            {/* Tabs */}
            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'items' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('items')}
                    disabled={loading}
                >
                    Menu Items
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'config' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('config')}
                    disabled={loading}
                >
                    Namespace Configuration
                </button>
            </div>

            {loading && <div className={styles.loading}>Loading...</div>}

            {!loading && activeTab === 'items' && (
                <MenuItemsTab
                    menuTree={menuTree}
                    editingNode={editingNode}
                    showCreateForm={showCreateForm}
                    saving={saving}
                    onSetEditingNode={setEditingNode}
                    onSetShowCreateForm={setShowCreateForm}
                    onCreateNode={handleCreateNode}
                    onUpdateNode={handleUpdateNode}
                    onDeleteNode={handleDeleteNode}
                />
            )}

            {!loading && activeTab === 'config' && config && (
                <NamespaceConfigTab
                    config={config}
                    saving={saving}
                    onConfigChange={setConfig}
                    onSave={handleSaveConfig}
                    onReset={handleResetConfig}
                />
            )}
        </div>
    );
}

/**
 * Menu Items tab component.
 */
function MenuItemsTab({
    menuTree,
    editingNode,
    showCreateForm,
    saving,
    onSetEditingNode,
    onSetShowCreateForm,
    onCreateNode,
    onUpdateNode,
    onDeleteNode
}: {
    menuTree: IMenuTree | null;
    editingNode: IMenuNode | null;
    showCreateForm: boolean;
    saving: boolean;
    onSetEditingNode: (node: IMenuNode | null) => void;
    onSetShowCreateForm: (show: boolean) => void;
    onCreateNode: (nodeData: Partial<IMenuNode>) => Promise<void>;
    onUpdateNode: (id: string, updates: Partial<IMenuNode>) => Promise<void>;
    onDeleteNode: (id: string, label: string) => Promise<void>;
}) {
    return (
        <div className={styles.content}>
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2>Menu Items</h2>
                    {!showCreateForm && !editingNode && (
                        <button
                            className={`${styles.button} ${styles.buttonPrimary}`}
                            onClick={() => onSetShowCreateForm(true)}
                        >
                            + Create Menu Item
                        </button>
                    )}
                </div>

                {showCreateForm && (
                    <MenuNodeForm
                        mode="create"
                        availableParents={menuTree?.all || []}
                        saving={saving}
                        onSubmit={onCreateNode}
                        onCancel={() => onSetShowCreateForm(false)}
                    />
                )}

                {editingNode && (
                    <MenuNodeForm
                        mode="edit"
                        node={editingNode}
                        availableParents={menuTree?.all.filter(n => n._id !== editingNode._id) || []}
                        saving={saving}
                        onSubmit={(updates) => onUpdateNode(editingNode._id!, updates)}
                        onCancel={() => onSetEditingNode(null)}
                    />
                )}

                {!showCreateForm && !editingNode && (
                    <>
                        <p className={styles.sectionDesc}>
                            {menuTree?.all.length === 0
                                ? 'No menu items yet. Create your first menu item to get started.'
                                : `${menuTree?.all.length} menu item(s) in this namespace.`}
                        </p>

                        {menuTree && menuTree.all.length > 0 && (
                            <MenuTreeView
                                tree={menuTree}
                                onEdit={onSetEditingNode}
                                onDelete={onDeleteNode}
                            />
                        )}
                    </>
                )}
            </section>
        </div>
    );
}

/**
 * Menu tree view component showing hierarchical menu structure.
 */
function MenuTreeView({
    tree,
    onEdit,
    onDelete
}: {
    tree: IMenuTree;
    onEdit: (node: IMenuNode) => void;
    onDelete: (id: string, label: string) => void;
}) {
    return (
        <div className={styles.menuTree}>
            {tree.all
                .filter(node => !node.parent)
                .sort((a, b) => a.order - b.order)
                .map(node => (
                    <MenuNodeItem
                        key={node._id}
                        node={node}
                        allNodes={tree.all}
                        level={0}
                        onEdit={onEdit}
                        onDelete={onDelete}
                    />
                ))}
        </div>
    );
}

/**
 * Individual menu node item with children.
 */
function MenuNodeItem({
    node,
    allNodes,
    level,
    onEdit,
    onDelete
}: {
    node: IMenuNode;
    allNodes: IMenuNode[];
    level: number;
    onEdit: (node: IMenuNode) => void;
    onDelete: (id: string, label: string) => void;
}) {
    const children = allNodes
        .filter(n => n.parent === node._id)
        .sort((a, b) => a.order - b.order);

    return (
        <div className={styles.menuNodeItem} style={{ paddingLeft: `${level * 24}px` }}>
            <div className={styles.menuNodeContent}>
                <div className={styles.menuNodeInfo}>
                    <span className={styles.menuNodeLabel}>
                        {node.icon && <span className={styles.menuNodeIcon}>[{node.icon}]</span>}
                        {node.label}
                    </span>
                    {node.url && <span className={styles.menuNodeUrl}>{node.url}</span>}
                    <span className={styles.menuNodeOrder}>Order: {node.order}</span>
                    {!node.enabled && <span className={styles.menuNodeDisabled}>Disabled</span>}
                </div>
                <div className={styles.menuNodeActions}>
                    <button
                        className={`${styles.button} ${styles.buttonSmall}`}
                        onClick={() => onEdit(node)}
                    >
                        Edit
                    </button>
                    <button
                        className={`${styles.button} ${styles.buttonSmall} ${styles.buttonDanger}`}
                        onClick={() => onDelete(node._id!, node.label)}
                    >
                        Delete
                    </button>
                </div>
            </div>

            {children.length > 0 && (
                <div className={styles.menuNodeChildren}>
                    {children.map(child => (
                        <MenuNodeItem
                            key={child._id}
                            node={child}
                            allNodes={allNodes}
                            level={level + 1}
                            onEdit={onEdit}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * Form for creating or editing a menu node.
 */
function MenuNodeForm({
    mode,
    node,
    availableParents,
    saving,
    onSubmit,
    onCancel
}: {
    mode: 'create' | 'edit';
    node?: IMenuNode;
    availableParents: IMenuNode[];
    saving: boolean;
    onSubmit: (data: Partial<IMenuNode>) => Promise<void>;
    onCancel: () => void;
}) {
    const [formData, setFormData] = useState<Partial<IMenuNode>>({
        label: node?.label || '',
        url: node?.url || '',
        icon: node?.icon || '',
        order: node?.order ?? 0,
        parent: node?.parent || null,
        enabled: node?.enabled ?? true,
        requiredRole: node?.requiredRole || ''
    });

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        void onSubmit(formData);
    }

    return (
        <form onSubmit={handleSubmit} className={styles.menuNodeForm}>
            <h3>{mode === 'create' ? 'Create Menu Item' : 'Edit Menu Item'}</h3>

            <div className={styles.field}>
                <label htmlFor="label">
                    Label <span className={styles.required}>*</span>
                </label>
                <input
                    id="label"
                    type="text"
                    value={formData.label}
                    onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                    className={styles.input}
                    required
                    disabled={saving}
                />
            </div>

            <div className={styles.field}>
                <label htmlFor="url">
                    URL
                    <span className={styles.hint}>Navigation path (e.g., /about)</span>
                </label>
                <input
                    id="url"
                    type="text"
                    value={formData.url || ''}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    className={styles.input}
                    disabled={saving}
                />
            </div>

            <div className={styles.field}>
                <label htmlFor="icon">
                    Icon
                    <span className={styles.hint}>Lucide React icon name (e.g., Home, Menu)</span>
                </label>
                <input
                    id="icon"
                    type="text"
                    value={formData.icon || ''}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    className={styles.input}
                    disabled={saving}
                />
            </div>

            <div className={styles.field}>
                <label htmlFor="order">Order</label>
                <input
                    id="order"
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value, 10) })}
                    className={styles.input}
                    disabled={saving}
                />
            </div>

            <div className={styles.field}>
                <label htmlFor="parent">Parent Item</label>
                <select
                    id="parent"
                    value={formData.parent || ''}
                    onChange={(e) => setFormData({ ...formData, parent: e.target.value || null })}
                    className={styles.select}
                    disabled={saving}
                >
                    <option value="">None (root level)</option>
                    {availableParents.map(p => (
                        <option key={p._id} value={p._id}>
                            {p.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className={styles.field}>
                <label htmlFor="requiredRole">Required Role</label>
                <input
                    id="requiredRole"
                    type="text"
                    value={formData.requiredRole || ''}
                    onChange={(e) => setFormData({ ...formData, requiredRole: e.target.value })}
                    className={styles.input}
                    disabled={saving}
                />
            </div>

            <label className={styles.checkboxLabel}>
                <input
                    type="checkbox"
                    checked={formData.enabled ?? true}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                    disabled={saving}
                />
                <span>Enabled</span>
            </label>

            <div className={styles.formActions}>
                <button
                    type="submit"
                    className={`${styles.button} ${styles.buttonPrimary}`}
                    disabled={saving || !formData.label}
                >
                    {saving ? 'Saving...' : mode === 'create' ? 'Create' : 'Update'}
                </button>
                <button
                    type="button"
                    className={styles.button}
                    onClick={onCancel}
                    disabled={saving}
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}

/**
 * Namespace Configuration tab component (existing functionality).
 */
function NamespaceConfigTab({
    config,
    saving,
    onConfigChange,
    onSave,
    onReset
}: {
    config: IMenuNamespaceConfig;
    saving: boolean;
    onConfigChange: (config: IMenuNamespaceConfig) => void;
    onSave: () => Promise<void>;
    onReset: () => Promise<void>;
}) {
    return (
        <div className={styles.content}>
            {/* Hamburger Menu Configuration */}
            <section className={styles.section}>
                <h2>Hamburger Menu</h2>
                <p className={styles.sectionDesc}>
                    Control when and how the menu collapses into a hamburger icon on smaller viewports.
                </p>

                <label className={styles.checkboxLabel}>
                    <input
                        type="checkbox"
                        checked={config.hamburgerMenu?.enabled ?? true}
                        onChange={(e) =>
                            onConfigChange({
                                ...config,
                                hamburgerMenu: {
                                    ...(config.hamburgerMenu || { triggerWidth: 768 }),
                                    enabled: e.target.checked
                                }
                            })
                        }
                    />
                    <span>Enable hamburger menu</span>
                </label>

                {config.hamburgerMenu?.enabled && (
                    <div className={styles.field}>
                        <label htmlFor="triggerWidth">
                            Trigger Width (px)
                            <span className={styles.hint}>
                                Container width that triggers hamburger mode
                            </span>
                        </label>
                        <input
                            id="triggerWidth"
                            type="number"
                            min={320}
                            max={2560}
                            value={config.hamburgerMenu?.triggerWidth ?? 768}
                            onChange={(e) =>
                                onConfigChange({
                                    ...config,
                                    hamburgerMenu: {
                                        enabled: config.hamburgerMenu?.enabled ?? true,
                                        triggerWidth: parseInt(e.target.value, 10)
                                    }
                                })
                            }
                            className={styles.input}
                        />
                    </div>
                )}
            </section>

            {/* Icon Configuration */}
            <section className={styles.section}>
                <h2>Icons</h2>
                <p className={styles.sectionDesc}>
                    Configure icon display settings for menu items.
                </p>

                <label className={styles.checkboxLabel}>
                    <input
                        type="checkbox"
                        checked={config.icons?.enabled ?? true}
                        onChange={(e) =>
                            onConfigChange({
                                ...config,
                                icons: {
                                    ...(config.icons || { position: 'left' }),
                                    enabled: e.target.checked
                                }
                            })
                        }
                    />
                    <span>Display icons</span>
                </label>

                {config.icons?.enabled && (
                    <div className={styles.field}>
                        <label htmlFor="iconPosition">Icon Position</label>
                        <select
                            id="iconPosition"
                            value={config.icons?.position || 'left'}
                            onChange={(e) =>
                                onConfigChange({
                                    ...config,
                                    icons: {
                                        enabled: config.icons?.enabled ?? true,
                                        position: e.target.value as 'left' | 'right' | 'top'
                                    }
                                })
                            }
                            className={styles.select}
                        >
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="top">Top</option>
                        </select>
                    </div>
                )}
            </section>

            {/* Layout Configuration */}
            <section className={styles.section}>
                <h2>Layout</h2>
                <p className={styles.sectionDesc}>
                    Control menu orientation and structural settings.
                </p>

                <div className={styles.field}>
                    <label htmlFor="orientation">Orientation</label>
                    <select
                        id="orientation"
                        value={config.layout?.orientation || 'horizontal'}
                        onChange={(e) =>
                            onConfigChange({
                                ...config,
                                layout: {
                                    ...(config.layout || {}),
                                    orientation: e.target.value as 'horizontal' | 'vertical'
                                }
                            })
                        }
                        className={styles.select}
                    >
                        <option value="horizontal">Horizontal</option>
                        <option value="vertical">Vertical</option>
                    </select>
                </div>

                <div className={styles.field}>
                    <label htmlFor="maxItems">
                        Max Items
                        <span className={styles.hint}>
                            Maximum items before overflow (leave empty for no limit)
                        </span>
                    </label>
                    <input
                        id="maxItems"
                        type="number"
                        min={1}
                        value={config.layout?.maxItems ?? ''}
                        onChange={(e) =>
                            onConfigChange({
                                ...config,
                                layout: {
                                    orientation: config.layout?.orientation || 'horizontal',
                                    maxItems: e.target.value ? parseInt(e.target.value, 10) : undefined
                                }
                            })
                        }
                        className={styles.input}
                        placeholder="No limit"
                    />
                </div>
            </section>

            {/* Styling Configuration */}
            <section className={styles.section}>
                <h2>Styling</h2>
                <p className={styles.sectionDesc}>
                    Visual styling hints for menu rendering.
                </p>

                <label className={styles.checkboxLabel}>
                    <input
                        type="checkbox"
                        checked={config.styling?.compact ?? false}
                        onChange={(e) =>
                            onConfigChange({
                                ...config,
                                styling: {
                                    ...(config.styling || {}),
                                    compact: e.target.checked
                                }
                            })
                        }
                    />
                    <span>Compact mode (tighter spacing, smaller text)</span>
                </label>

                <label className={styles.checkboxLabel}>
                    <input
                        type="checkbox"
                        checked={config.styling?.showLabels ?? true}
                        onChange={(e) =>
                            onConfigChange({
                                ...config,
                                styling: {
                                    ...(config.styling || {}),
                                    showLabels: e.target.checked
                                }
                            })
                        }
                    />
                    <span>Show text labels</span>
                </label>
            </section>

            {/* Action Buttons */}
            <div className={styles.actions}>
                <button
                    onClick={onSave}
                    disabled={saving}
                    className={`${styles.button} ${styles.buttonPrimary}`}
                >
                    {saving ? 'Saving...' : 'Save Configuration'}
                </button>

                <button
                    onClick={onReset}
                    disabled={saving}
                    className={`${styles.button} ${styles.buttonDanger}`}
                >
                    Reset to Defaults
                </button>
            </div>
        </div>
    );
}
