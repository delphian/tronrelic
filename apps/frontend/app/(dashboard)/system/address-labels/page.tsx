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
import { Plus, Download, Upload, Tags } from 'lucide-react';
import { useSystemAuth } from '../../../../features/system';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import {
    LabelStats,
    CreateLabelForm,
    ImportLabelsForm,
    LabelCard,
    LabelFilters,
    type AddressLabel,
    type LabelStatsType,
    type CreateLabelFormState,
    type ImportResult
} from './components';
import styles from './page.module.css';

/**
 * Initial state for the create form.
 */
const INITIAL_CREATE_FORM: CreateLabelFormState = {
    address: '',
    label: '',
    category: 'unknown',
    tags: '',
    source: 'system',
    sourceType: 'system',
    confidence: 50,
    verified: false,
    notes: ''
};

/**
 * Address labels management page.
 *
 * Provides admin interface for:
 * - Listing and searching labels
 * - Creating new labels
 * - Editing existing labels
 * - Deleting labels
 * - Viewing statistics
 * - Import/export functionality
 */
export default function AddressLabelsPage() {
    const { token } = useSystemAuth();

    // List state
    const [labels, setLabels] = useState<AddressLabel[]>([]);
    const [stats, setStats] = useState<LabelStatsType | null>(null);
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
    const [createForm, setCreateForm] = useState<CreateLabelFormState>(INITIAL_CREATE_FORM);
    const [createLoading, setCreateLoading] = useState(false);

    // Edit state
    const [editingAddress, setEditingAddress] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<AddressLabel>>({});

    // Import state
    const [showImportForm, setShowImportForm] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importLoading, setImportLoading] = useState(false);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);

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
        } catch {
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

            setCreateForm(INITIAL_CREATE_FORM);
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
     * Maximum file size for import (5MB).
     */
    const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

    /**
     * Import labels from uploaded JSON file.
     */
    const handleImport = async () => {
        if (!token || !importFile) return;

        setImportLoading(true);
        setImportResult(null);

        try {
            // Validate file size before parsing
            if (importFile.size > MAX_IMPORT_FILE_SIZE) {
                throw new Error(`File too large. Maximum size is ${MAX_IMPORT_FILE_SIZE / 1024 / 1024}MB`);
            }

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
            {stats && <LabelStats stats={stats} />}

            {/* Create Form */}
            {showCreateForm && (
                <CreateLabelForm
                    form={createForm}
                    loading={createLoading}
                    onFormChange={setCreateForm}
                    onCreate={handleCreate}
                    onCancel={() => setShowCreateForm(false)}
                />
            )}

            {/* Import Form */}
            {showImportForm && (
                <ImportLabelsForm
                    file={importFile}
                    loading={importLoading}
                    result={importResult}
                    onFileChange={setImportFile}
                    onImport={handleImport}
                    onClose={closeImportForm}
                />
            )}

            {/* Filters */}
            <LabelFilters
                categoryFilter={categoryFilter}
                sourceTypeFilter={sourceTypeFilter}
                searchInput={searchInput}
                onCategoryChange={value => { setCategoryFilter(value); setPage(1); }}
                onSourceTypeChange={value => { setSourceTypeFilter(value); setPage(1); }}
                onSearchChange={setSearchInput}
                onSearch={handleSearch}
            />

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
                            <LabelCard
                                key={`${label.address}-${label.source}`}
                                label={label}
                                isEditing={editingAddress === label.address}
                                editForm={editForm}
                                onEdit={() => { setEditingAddress(label.address); setEditForm({}); }}
                                onEditChange={setEditForm}
                                onSave={() => handleUpdate(label.address, label.source)}
                                onCancelEdit={() => { setEditingAddress(null); setEditForm({}); }}
                                onDelete={() => handleDelete(label.address, label.source)}
                            />
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
