'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Upload, Trash2, Copy, Image, File } from 'lucide-react';
import type { IPageFile } from '@tronrelic/types';
import styles from './FilesTab.module.css';

/**
 * API response for files list endpoint.
 */
interface IFilesListResponse {
    files: IPageFile[];
}

/**
 * Props for FilesTab component.
 */
interface FilesTabProps {
    token: string;
}

/**
 * Files tab - Upload and manage files.
 *
 * Provides file management features including:
 * - File upload with drag-and-drop support
 * - Browse uploaded files with thumbnail previews
 * - Copy markdown syntax for images
 * - Delete files with confirmation
 * - Filter by MIME type
 */
export function FilesTab({ token }: FilesTabProps) {
    const [files, setFiles] = useState<IPageFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mimeTypeFilter, setMimeTypeFilter] = useState<string>('all');
    const fileInputRef = useRef<HTMLInputElement>(null);

    /**
     * Fetch files list from API.
     *
     * Applies current MIME type filter and updates component state.
     */
    const fetchFiles = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (mimeTypeFilter !== 'all') {
                params.append('mimeType', mimeTypeFilter);
            }

            const response = await fetch(`/api/admin/pages/files?${params}`, {
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
    }, [token, mimeTypeFilter]);

    /**
     * Upload a file to the server.
     *
     * Sends multipart/form-data request with file buffer. Validates file
     * is selected before proceeding. Refreshes file list on success.
     *
     * @param file - File object from input or drop event
     */
    const uploadFile = async (file: File) => {
        setUploading(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/admin/pages/files', {
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

            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to upload file');
        } finally {
            setUploading(false);
        }
    };

    /**
     * Delete a file by ID.
     *
     * Sends DELETE request with confirmation dialog. Refreshes list on success.
     *
     * @param id - File ID to delete
     */
    const deleteFile = async (id: string) => {
        if (!confirm('Are you sure you want to delete this file? Pages using this file will have broken links.')) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/pages/files/${id}`, {
                method: 'DELETE',
                headers: {
                    'x-admin-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to delete file: ${response.statusText}`);
            }

            await fetchFiles();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete file');
        }
    };

    /**
     * Copy markdown syntax to clipboard.
     *
     * Generates markdown image or link syntax based on file type and copies
     * to clipboard. Shows temporary success feedback.
     *
     * @param file - File to generate markdown for
     */
    const copyMarkdown = async (file: IPageFile) => {
        const isImage = file.mimeType.startsWith('image/');
        const markdown = isImage
            ? `![${file.originalName}](${file.path})`
            : `[${file.originalName}](${file.path})`;

        try {
            await navigator.clipboard.writeText(markdown);
            // Could show a toast notification here
            alert('Markdown syntax copied to clipboard!');
        } catch (err) {
            setError('Failed to copy to clipboard');
        }
    };

    /**
     * Handle file input change event.
     *
     * Triggers upload for selected file.
     */
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            void uploadFile(file);
        }
    };

    /**
     * Format file size for display.
     *
     * Converts bytes to human-readable format (KB, MB).
     *
     * @param bytes - File size in bytes
     * @returns Formatted size string
     */
    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Initial load and refresh on filter changes
    useEffect(() => {
        void fetchFiles();
    }, [fetchFiles]);

    if (loading) {
        return (
            <Card padding="lg">
                <p>Loading files...</p>
            </Card>
        );
    }

    return (
        <div className={styles.container}>
            {/* Error Display */}
            {error && (
                <Card tone="muted" padding="md">
                    <p className={styles.error}>{error}</p>
                </Card>
            )}

            {/* Upload Controls */}
            <Card padding="md">
                <div className={styles.controls}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileSelect}
                        className={styles.file_input}
                        id="file-upload"
                    />
                    <Button
                        variant="primary"
                        size="md"
                        icon={<Upload size={18} />}
                        loading={uploading}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        Upload File
                    </Button>
                    <select
                        value={mimeTypeFilter}
                        onChange={e => setMimeTypeFilter(e.target.value)}
                        className={styles.filter_select}
                    >
                        <option value="all">All Files</option>
                        <option value="image/">Images</option>
                        <option value="application/">Documents</option>
                    </select>
                </div>
            </Card>

            {/* Files Grid */}
            <Card padding="md">
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
                                <div key={file._id} className={styles.file_card}>
                                    <div className={styles.file_preview}>
                                        {isImage ? (
                                            <img
                                                src={file.path}
                                                alt={file.originalName}
                                                className={styles.file_image}
                                            />
                                        ) : (
                                            <div className={styles.file_icon}>
                                                <File size={48} />
                                            </div>
                                        )}
                                    </div>
                                    <div className={styles.file_info}>
                                        <p className={styles.file_name}>{file.originalName}</p>
                                        <p className={styles.file_path}>{file.path}</p>
                                        <div className={styles.file_meta}>
                                            <Badge tone="neutral">{formatFileSize(file.size)}</Badge>
                                            <span className={styles.file_date}>
                                                {new Date(file.uploadedAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                    <div className={styles.file_actions}>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={<Copy size={16} />}
                                            onClick={() => void copyMarkdown(file)}
                                        >
                                            Copy MD
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={<Trash2 size={16} />}
                                            onClick={() => file._id && deleteFile(file._id)}
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>
        </div>
    );
}
