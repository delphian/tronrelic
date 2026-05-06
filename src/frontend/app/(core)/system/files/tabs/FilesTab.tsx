'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { ConfirmDialog } from '../../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { Upload, Trash2, Copy, File } from 'lucide-react';
import type { IFileRecord, IFileSource } from '@/types';
import styles from './FilesTab.module.scss';

/** API response for the files list endpoint. */
interface IFilesListResponse {
    files: IFileRecord[];
}

/** API response for the distinct file-sources endpoint. */
interface IFileSourcesResponse {
    sources: IFileSource[];
}

/**
 * Wire encoding for the `source` query parameter. `'all'` drops the filter
 * entirely (cross-source view); `'<kind>:<id>'` scopes to a single source.
 * Admin browsing defaults to cross-source so newly-uploaded admin files
 * (tagged `module:files`), legacy page attachments (tagged `module:pages`),
 * and plugin outputs are all visible without forcing the operator to pick.
 */
const ALL_SOURCES = 'all';

function encodeSource(source: IFileSource): string {
    return `${source.kind}:${source.id}`;
}

interface FilesTabProps {
    token: string;
}

/**
 * Files tab — upload, browse, copy markdown for, and delete files in the
 * unified inventory. Cross-source listing is the documented escape hatch
 * for admin tooling.
 */
export function FilesTab({ token }: FilesTabProps) {
    const [files, setFiles] = useState<IFileRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mimeTypeFilter, setMimeTypeFilter] = useState<string>('all');
    const [sourceFilter, setSourceFilter] = useState<string>(ALL_SOURCES);
    const [availableSources, setAvailableSources] = useState<IFileSource[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const toast = useToast();
    const { open: openModal, close: closeModal } = useModal();

    const fetchFiles = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            params.append('source', sourceFilter);
            if (mimeTypeFilter !== 'all') {
                params.append('mimeType', mimeTypeFilter);
            }

            const response = await fetch(`/api/admin/files?${params}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch files: ${response.statusText}`);
            }

            const data: IFilesListResponse = await response.json();
            setFiles(data.files);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch files');
        } finally {
            setLoading(false);
        }
    }, [token, mimeTypeFilter, sourceFilter]);

    /**
     * Populate the source dropdown from the inventory. A freshly enabled
     * plugin that hasn't uploaded anything legitimately won't appear until
     * its first write.
     */
    const fetchSources = useCallback(async () => {
        try {
            const response = await fetch('/api/admin/files/sources', {
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch sources: ${response.statusText}`);
            }

            const data: IFileSourcesResponse = await response.json();
            setAvailableSources(data.sources);
        } catch {
            // Leave the existing list intact on transient failure.
        }
    }, [token]);

    const uploadFile = async (file: File) => {
        setUploading(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/admin/files', {
                method: 'POST',
                headers: {
                    'x-admin-token': token
                },
                body: formData
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || `Failed to upload file: ${response.statusText}`);
            }

            await fetchFiles();

            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to upload file');
        } finally {
            setUploading(false);
        }
    };

    const requestDeleteFile = (file: IFileRecord) => {
        const modalId = openModal({
            title: 'Delete file',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={file.originalName}
                    message={
                        <>
                            Delete <strong>{file.originalName}</strong>? Anything
                            referencing this file (pages, plugin outputs) will have
                            broken links.
                        </>
                    }
                    onCancel={() => closeModal(modalId)}
                    onConfirm={async () => {
                        try {
                            const response = await fetch(`/api/admin/files/${file.id}`, {
                                method: 'DELETE',
                                headers: { 'x-admin-token': token }
                            });
                            if (!response.ok) {
                                throw new Error(`Failed to delete file: ${response.statusText}`);
                            }
                            closeModal(modalId);
                            toast.push({ tone: 'success', title: 'File deleted' });
                            await fetchFiles();
                        } catch (err) {
                            closeModal(modalId);
                            setError(err instanceof Error ? err.message : 'Failed to delete file');
                        }
                    }}
                />
            )
        });
    };

    const copyMarkdown = async (file: IFileRecord) => {
        const isImage = file.mimeType.startsWith('image/');
        const markdown = isImage
            ? `![${file.originalName}](${file.url})`
            : `[${file.originalName}](${file.url})`;

        try {
            await navigator.clipboard.writeText(markdown);
            toast.push({ tone: 'success', title: 'Markdown copied to clipboard' });
        } catch {
            setError('Failed to copy to clipboard');
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            void uploadFile(file);
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    useEffect(() => {
        void fetchFiles();
    }, [fetchFiles]);

    // Refresh sources after a successful upload so a new source becomes
    // selectable. Wired to `files.length` as a cheap "inventory may have
    // changed" proxy.
    useEffect(() => {
        void fetchSources();
    }, [fetchSources, files.length]);

    if (loading) {
        return (
            <Card padding="lg">
                <p>Loading files...</p>
            </Card>
        );
    }

    return (
        <div className={styles.container}>
            {error && (
                <Card tone="muted" padding="sm">
                    <p className={styles.error}>{error}</p>
                </Card>
            )}

            <div className={styles.controls}>
                <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    className={styles.file_input}
                    id="file-upload"
                    aria-label="Choose file to upload"
                />
                <Button
                    variant="primary"
                    size="sm"
                    icon={<Upload size={18} />}
                    loading={uploading}
                    onClick={() => fileInputRef.current?.click()}
                >
                    Upload
                </Button>
                <select
                    value={sourceFilter}
                    onChange={e => setSourceFilter(e.target.value)}
                    className={styles.filter_select}
                    aria-label="Filter by file source"
                >
                    <option value={ALL_SOURCES}>All Sources</option>
                    {availableSources.map(source => {
                        const value = encodeSource(source);
                        return (
                            <option key={value} value={value}>
                                {source.kind}: {source.id}
                            </option>
                        );
                    })}
                </select>
                <select
                    value={mimeTypeFilter}
                    onChange={e => setMimeTypeFilter(e.target.value)}
                    className={styles.filter_select}
                    aria-label="Filter by MIME type"
                >
                    <option value="all">All Files</option>
                    <option value="image/">Images</option>
                    <option value="application/">Documents</option>
                </select>
            </div>

            {files.length === 0 ? (
                <div className={styles.empty}>
                    <p>No files uploaded yet</p>
                    <p className={styles.empty_hint}>Upload images, icons, or documents to use in your pages</p>
                </div>
            ) : (
                <div className={styles.files_grid}>
                    {files.map(file => {
                        const isImage = file.mimeType.startsWith('image/');
                        return (
                            <div key={file.id} className={styles.file_card}>
                                <div className={styles.file_preview}>
                                    {isImage ? (
                                        <img
                                            src={file.url}
                                            alt={file.originalName}
                                            className={styles.file_image}
                                        />
                                    ) : (
                                        <div className={styles.file_icon}>
                                            <File size={40} />
                                        </div>
                                    )}
                                </div>
                                <div className={styles.file_info}>
                                    <p className={styles.file_name}>{file.originalName}</p>
                                    <p className={styles.file_path} title={file.url}>{file.url}</p>
                                    <div className={styles.file_meta}>
                                        <Badge tone="neutral">{formatFileSize(file.sizeBytes)}</Badge>
                                        <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                                <div className={styles.file_actions}>
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        icon={<Copy size={14} />}
                                        onClick={() => void copyMarkdown(file)}
                                        aria-label={`Copy markdown link for ${file.originalName}`}
                                    >
                                        Copy MD
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        icon={<Trash2 size={14} />}
                                        onClick={() => requestDeleteFile(file)}
                                        aria-label={`Delete ${file.originalName}`}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
