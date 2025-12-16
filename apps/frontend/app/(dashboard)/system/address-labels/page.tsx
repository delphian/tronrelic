/**
 * Address labels admin page.
 *
 * Provides management interface for blockchain address labels.
 * Enables administrators to create, edit, delete, and search labels
 * that identify addresses throughout the platform.
 *
 * Admin pages are client components that fetch data with the admin token.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Download, Upload, Trash2, Edit, Check, X, Tag, Tags } from 'lucide-react';
import { useSystemAuth } from '../../../../features/system';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import styles from './page.module.css';

/**
 * Address label data from the API.
 */
interface AddressLabel {
    address: string;
    label: string;
    category: string;
    tags: string[];
    source: string;
    sourceType: string;
    confidence: number;
    verified: boolean;
    tronMetadata?: {
        superRepresentative?: boolean;
        energyProvider?: boolean;
        contractType?: string;
        tokenSymbol?: string;
        tokenName?: string;
    };
    notes?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Statistics from the API.
 */
interface LabelStats {
    total: number;
    byCategory: Record<string, number>;
    bySourceType: Record<string, number>;
    verified: number;
    unverified: number;
}

/**
 * Category options for the select dropdown.
 */
const CATEGORIES = [
    { value: 'exchange', label: 'Exchange' },
    { value: 'whale', label: 'Whale' },
    { value: 'contract', label: 'Contract' },
    { value: 'institution', label: 'Institution' },
    { value: 'risk', label: 'Risk' },
    { value: 'user', label: 'User' },
    { value: 'unknown', label: 'Unknown' }
];

/**
 * Source type options.
 */
const SOURCE_TYPES = [
    { value: 'system', label: 'System' },
    { value: 'user', label: 'User' },
    { value: 'plugin', label: 'Plugin' },
    { value: 'import', label: 'Import' }
];

/**
 * Address labels management page.
 *
 * Provides admin interface for:
 * - Listing and searching labels
 * - Creating new labels
 * - Editing existing labels
 * - Deleting labels
 * - Viewing statistics
 */
export default function AddressLabelsPage() {
    const { token } = useSystemAuth();

    // List state
    const [labels, setLabels] = useState<AddressLabel[]>([]);
    const [stats, setStats] = useState<LabelStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Pagination
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [limit] = useState(20);

    // Filters
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchInput, setSearchInput] = useState('');

    // Create form state
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createForm, setCreateForm] = useState({
        address: '',
        label: '',
        category: 'unknown',
        tags: '',
        source: 'system',
        sourceType: 'system',
        confidence: 50,
        verified: false,
        notes: ''
    });
    const [createLoading, setCreateLoading] = useState(false);

    // Edit state
    const [editingAddress, setEditingAddress] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<AddressLabel>>({});

    // Import state
    const [showImportForm, setShowImportForm] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importLoading, setImportLoading] = useState(false);
    const [importResult, setImportResult] = useState<{
        imported: number;
        updated: number;
        failed: number;
        errors: { address: string; error: string }[];
    } | null>(null);

    /**
     * Fetch labels from the admin API.
     */
    const fetchLabels = useCallback(async () => {
        if (!token) return;

        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString()
            });

            if (categoryFilter) params.append('category', categoryFilter);
            if (sourceTypeFilter) params.append('sourceType', sourceTypeFilter);
            if (searchQuery) params.append('search', searchQuery);

            const response = await fetch(`/api/admin/address-labels?${params}`, {
                headers: { 'X-Admin-Token': token }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch labels: ${response.statusText}`);
            }

            const data = await response.json();
            setLabels(data.labels);
            setTotal(data.total);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch labels');
        } finally {
            setLoading(false);
        }
    }, [token, page, limit, categoryFilter, sourceTypeFilter, searchQuery]);

    /**
     * Fetch statistics from the admin API.
     */
    const fetchStats = useCallback(async () => {
        if (!token) return;

        try {
            const response = await fetch('/api/admin/address-labels/stats', {
                headers: { 'X-Admin-Token': token }
            });

            if (response.ok) {
                const data = await response.json();
                setStats(data.stats);
            }
        } catch (err) {
            // Stats are non-critical, don't show error
        }
    }, [token]);

    /**
     * Create a new label.
     */
    const handleCreate = async () => {
        if (!token || !createForm.address || !createForm.label) return;

        setCreateLoading(true);

        try {
            const response = await fetch('/api/admin/address-labels', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify({
                    ...createForm,
                    tags: createForm.tags.split(',').map(t => t.trim()).filter(Boolean)
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to create label: ${response.statusText}`);
            }

            // Reset form and refresh
            setCreateForm({
                address: '',
                label: '',
                category: 'unknown',
                tags: '',
                source: 'system',
                sourceType: 'system',
                confidence: 50,
                verified: false,
                notes: ''
            });
            setShowCreateForm(false);
            fetchLabels();
            fetchStats();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create label');
        } finally {
            setCreateLoading(false);
        }
    };

    /**
     * Update an existing label.
     */
    const handleUpdate = async (address: string, source: string) => {
        if (!token) return;

        try {
            const response = await fetch(`/api/admin/address-labels/${encodeURIComponent(address)}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify({ source, ...editForm })
            });

            if (!response.ok) {
                throw new Error(`Failed to update label: ${response.statusText}`);
            }

            setEditingAddress(null);
            setEditForm({});
            fetchLabels();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update label');
        }
    };

    /**
     * Delete a label.
     */
    const handleDelete = async (address: string, source: string) => {
        if (!token || !confirm('Are you sure you want to delete this label?')) return;

        try {
            const response = await fetch(
                `/api/admin/address-labels/${encodeURIComponent(address)}?source=${encodeURIComponent(source)}`,
                {
                    method: 'DELETE',
                    headers: { 'X-Admin-Token': token }
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to delete label: ${response.statusText}`);
            }

            fetchLabels();
            fetchStats();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete label');
        }
    };

    /**
     * Handle search form submission.
     */
    const handleSearch = () => {
        setSearchQuery(searchInput);
        setPage(1);
    };

    /**
     * Export labels as JSON file download.
     */
    const handleExport = async () => {
        if (!token) return;

        try {
            const params = new URLSearchParams();
            if (categoryFilter) params.append('category', categoryFilter);
            if (sourceTypeFilter) params.append('sourceType', sourceTypeFilter);

            const response = await fetch(`/api/admin/address-labels/export?${params}`, {
                headers: { 'X-Admin-Token': token }
            });

            if (!response.ok) {
                throw new Error(`Export failed: ${response.statusText}`);
            }

            const data = await response.json();

            const blob = new Blob([JSON.stringify(data.labels, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `address-labels-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to export labels');
        }
    };

    /**
     * Import labels from uploaded JSON file.
     */
    const handleImport = async () => {
        if (!token || !importFile) return;

        setImportLoading(true);
        setImportResult(null);

        try {
            const text = await importFile.text();
            const labels = JSON.parse(text);

            if (!Array.isArray(labels)) {
                throw new Error('Invalid format: expected an array of labels');
            }

            const response = await fetch('/api/admin/address-labels/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify({ labels })
            });

            if (!response.ok) {
                throw new Error(`Import failed: ${response.statusText}`);
            }

            const data = await response.json();
            setImportResult(data.result);
            fetchLabels();
            fetchStats();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to import labels');
        } finally {
            setImportLoading(false);
        }
    };

    /**
     * Close import form and reset state.
     */
    const closeImportForm = () => {
        setShowImportForm(false);
        setImportFile(null);
        setImportResult(null);
    };

    // Fetch data on mount and when filters change
    useEffect(() => {
        fetchLabels();
    }, [fetchLabels]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    const totalPages = Math.ceil(total / limit);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.titleSection}>
                    <Tags size={28} className={styles.titleIcon} />
                    <div>
                        <h1 className={styles.title}>Address Labels</h1>
                        <p className={styles.subtitle}>
                            Manage blockchain address labels for human-readable identification
                        </p>
                    </div>
                </div>
                <div className={styles.headerActions}>
                    <Button
                        variant="secondary"
                        size="md"
                        icon={<Download size={16} />}
                        onClick={handleExport}
                    >
                        Export
                    </Button>
                    <Button
                        variant="secondary"
                        size="md"
                        icon={<Upload size={16} />}
                        onClick={() => setShowImportForm(!showImportForm)}
                    >
                        Import
                    </Button>
                    <Button
                        variant="primary"
                        size="md"
                        icon={<Plus size={16} />}
                        onClick={() => setShowCreateForm(!showCreateForm)}
                    >
                        {showCreateForm ? 'Cancel' : 'New Label'}
                    </Button>
                </div>
            </header>

            {/* Statistics */}
            {stats && (
                <div className={styles.statsGrid}>
                    <Card padding="md">
                        <div className={styles.statCard}>
                            <span className={styles.statValue}>{stats.total}</span>
                            <span className={styles.statLabel}>Total Labels</span>
                        </div>
                    </Card>
                    <Card padding="md">
                        <div className={styles.statCard}>
                            <span className={styles.statValue}>{stats.verified}</span>
                            <span className={styles.statLabel}>Verified</span>
                        </div>
                    </Card>
                    <Card padding="md">
                        <div className={styles.statCard}>
                            <span className={styles.statValue}>
                                {stats.byCategory['exchange'] || 0}
                            </span>
                            <span className={styles.statLabel}>Exchanges</span>
                        </div>
                    </Card>
                    <Card padding="md">
                        <div className={styles.statCard}>
                            <span className={styles.statValue}>
                                {stats.byCategory['whale'] || 0}
                            </span>
                            <span className={styles.statLabel}>Whales</span>
                        </div>
                    </Card>
                </div>
            )}

            {/* Create Form */}
            {showCreateForm && (
                <Card padding="lg">
                    <h2 className={styles.formTitle}>Create New Label</h2>
                    <div className={styles.formGrid}>
                        <div className={styles.formField}>
                            <label>Address *</label>
                            <input
                                type="text"
                                value={createForm.address}
                                onChange={e => setCreateForm({ ...createForm, address: e.target.value })}
                                placeholder="T..."
                                className={styles.input}
                            />
                        </div>
                        <div className={styles.formField}>
                            <label>Label *</label>
                            <input
                                type="text"
                                value={createForm.label}
                                onChange={e => setCreateForm({ ...createForm, label: e.target.value })}
                                placeholder="e.g., Binance Hot Wallet"
                                className={styles.input}
                            />
                        </div>
                        <div className={styles.formField}>
                            <label>Category</label>
                            <select
                                value={createForm.category}
                                onChange={e => setCreateForm({ ...createForm, category: e.target.value })}
                                className={styles.select}
                            >
                                {CATEGORIES.map(cat => (
                                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className={styles.formField}>
                            <label>Source Type</label>
                            <select
                                value={createForm.sourceType}
                                onChange={e => setCreateForm({ ...createForm, sourceType: e.target.value })}
                                className={styles.select}
                            >
                                {SOURCE_TYPES.map(st => (
                                    <option key={st.value} value={st.value}>{st.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className={styles.formField}>
                            <label>Tags (comma-separated)</label>
                            <input
                                type="text"
                                value={createForm.tags}
                                onChange={e => setCreateForm({ ...createForm, tags: e.target.value })}
                                placeholder="cex, hot-wallet"
                                className={styles.input}
                            />
                        </div>
                        <div className={styles.formField}>
                            <label>Confidence (0-100)</label>
                            <input
                                type="number"
                                value={createForm.confidence}
                                onChange={e => setCreateForm({ ...createForm, confidence: parseInt(e.target.value) || 50 })}
                                min={0}
                                max={100}
                                className={styles.input}
                            />
                        </div>
                        <div className={styles.formFieldFull}>
                            <label>Notes</label>
                            <textarea
                                value={createForm.notes}
                                onChange={e => setCreateForm({ ...createForm, notes: e.target.value })}
                                placeholder="Additional context..."
                                className={styles.textarea}
                            />
                        </div>
                        <div className={styles.formFieldFull}>
                            <label className={styles.checkbox}>
                                <input
                                    type="checkbox"
                                    checked={createForm.verified}
                                    onChange={e => setCreateForm({ ...createForm, verified: e.target.checked })}
                                />
                                <span>Verified</span>
                            </label>
                        </div>
                    </div>
                    <div className={styles.formActions}>
                        <Button
                            variant="secondary"
                            onClick={() => setShowCreateForm(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleCreate}
                            loading={createLoading}
                            disabled={!createForm.address || !createForm.label}
                        >
                            Create Label
                        </Button>
                    </div>
                </Card>
            )}

            {/* Import Form */}
            {showImportForm && (
                <Card padding="lg">
                    <h2 className={styles.formTitle}>Import Labels</h2>
                    <p className={styles.importDescription}>
                        Upload a JSON file containing an array of address labels.
                        Each label must have: address, label, category, source, sourceType.
                    </p>
                    <div className={styles.importForm}>
                        <input
                            type="file"
                            accept=".json"
                            onChange={e => setImportFile(e.target.files?.[0] || null)}
                            className={styles.fileInput}
                        />
                        {importFile && (
                            <span className={styles.fileName}>{importFile.name}</span>
                        )}
                    </div>
                    {importResult && (
                        <div className={styles.importResult}>
                            <Badge tone="success">{importResult.imported} imported</Badge>
                            <Badge tone="neutral">{importResult.updated} updated</Badge>
                            {importResult.failed > 0 && (
                                <Badge tone="danger">{importResult.failed} failed</Badge>
                            )}
                            {importResult.errors.length > 0 && (
                                <div className={styles.importErrors}>
                                    {importResult.errors.slice(0, 5).map((err, i) => (
                                        <div key={i} className={styles.importError}>
                                            <code>{err.address}</code>: {err.error}
                                        </div>
                                    ))}
                                    {importResult.errors.length > 5 && (
                                        <div className={styles.importError}>
                                            ...and {importResult.errors.length - 5} more errors
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <div className={styles.formActions}>
                        <Button variant="secondary" onClick={closeImportForm}>
                            Close
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleImport}
                            loading={importLoading}
                            disabled={!importFile}
                        >
                            Import
                        </Button>
                    </div>
                </Card>
            )}

            {/* Filters */}
            <Card padding="md">
                <div className={styles.filters}>
                    <div className={styles.filterGroup}>
                        <select
                            value={categoryFilter}
                            onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
                            className={styles.select}
                        >
                            <option value="">All Categories</option>
                            {CATEGORIES.map(cat => (
                                <option key={cat.value} value={cat.value}>{cat.label}</option>
                            ))}
                        </select>
                        <select
                            value={sourceTypeFilter}
                            onChange={e => { setSourceTypeFilter(e.target.value); setPage(1); }}
                            className={styles.select}
                        >
                            <option value="">All Sources</option>
                            {SOURCE_TYPES.map(st => (
                                <option key={st.value} value={st.value}>{st.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.searchBox}>
                        <input
                            type="text"
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSearch()}
                            placeholder="Search labels..."
                            className={styles.input}
                        />
                        <Button variant="secondary" size="sm" onClick={handleSearch}>
                            <Search size={16} />
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Error */}
            {error && (
                <Card tone="muted" padding="md">
                    <div className={styles.error}>{error}</div>
                </Card>
            )}

            {/* Labels List */}
            <Card padding="md">
                {loading ? (
                    <div className={styles.loading}>Loading...</div>
                ) : labels.length === 0 ? (
                    <div className={styles.empty}>No labels found</div>
                ) : (
                    <div className={styles.labelsList}>
                        {labels.map(label => (
                            <div key={`${label.address}-${label.source}`} className={styles.labelCard}>
                                {editingAddress === label.address ? (
                                    // Edit mode
                                    <div className={styles.editForm}>
                                        <input
                                            type="text"
                                            value={editForm.label ?? label.label}
                                            onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                                            className={styles.input}
                                        />
                                        <select
                                            value={editForm.category ?? label.category}
                                            onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                                            className={styles.select}
                                        >
                                            {CATEGORIES.map(cat => (
                                                <option key={cat.value} value={cat.value}>{cat.label}</option>
                                            ))}
                                        </select>
                                        <div className={styles.editActions}>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => { setEditingAddress(null); setEditForm({}); }}
                                            >
                                                <X size={16} />
                                            </Button>
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={() => handleUpdate(label.address, label.source)}
                                            >
                                                <Check size={16} />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    // Display mode
                                    <>
                                        <div className={styles.labelHeader}>
                                            <div className={styles.labelInfo}>
                                                <span className={styles.labelName}>{label.label}</span>
                                                <Badge tone={label.verified ? 'success' : 'neutral'}>
                                                    {label.category}
                                                </Badge>
                                                {label.verified && (
                                                    <Badge tone="success">Verified</Badge>
                                                )}
                                            </div>
                                            <div className={styles.labelActions}>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => { setEditingAddress(label.address); setEditForm({}); }}
                                                >
                                                    <Edit size={14} />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDelete(label.address, label.source)}
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        </div>
                                        <div className={styles.labelAddress}>
                                            <code>{label.address}</code>
                                        </div>
                                        <div className={styles.labelMeta}>
                                            <span>Source: {label.source} ({label.sourceType})</span>
                                            <span>Confidence: {label.confidence}%</span>
                                        </div>
                                        {label.tags.length > 0 && (
                                            <div className={styles.labelTags}>
                                                {label.tags.map(tag => (
                                                    <span key={tag} className={styles.tag}>
                                                        <Tag size={12} />
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {label.notes && (
                                            <div className={styles.labelNotes}>{label.notes}</div>
                                        )}
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className={styles.pagination}>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page <= 1}
                        >
                            Previous
                        </Button>
                        <span className={styles.pageInfo}>
                            Page {page} of {totalPages}
                        </span>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                        >
                            Next
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    );
}
