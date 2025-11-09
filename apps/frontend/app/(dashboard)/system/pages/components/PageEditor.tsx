'use client';

import { useState, useEffect } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Save, X, Eye } from 'lucide-react';
import type { IPage } from '@tronrelic/types';
import styles from './PageEditor.module.css';

/**
 * Default frontmatter template for new pages.
 *
 * Provides structure and examples for all supported metadata fields.
 */
const DEFAULT_FRONTMATTER = `---
title: "Untitled Page"
slug: "/untitled-page"
description: "Page description for SEO"
keywords: ["keyword1", "keyword2"]
published: false
ogImage: ""
---

# Page Content

Start writing your content here using Markdown syntax.

## Formatting Examples

- **Bold text**
- *Italic text*
- [Link text](https://example.com)
- ![Image alt text](/uploads/25/10/image.png)

## Code Blocks

\`\`\`javascript
const example = "code block";
\`\`\`
`;

/**
 * Props for PageEditor component.
 */
interface PageEditorProps {
    token: string;
    page: IPage | null;
    onSave: () => void;
    onCancel: () => void;
}

/**
 * Page editor component with markdown editing and live preview.
 *
 * Provides:
 * - Split-pane markdown editor with syntax highlighting
 * - Live HTML preview using backend rendering
 * - Frontmatter template for new pages
 * - Create and update operations
 * - Validation and error handling
 */
export function PageEditor({ token, page, onSave, onCancel }: PageEditorProps) {
    const [content, setContent] = useState(page?.content || DEFAULT_FRONTMATTER);
    const [preview, setPreview] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Fetch preview HTML from backend.
     *
     * Sends current markdown content to the preview endpoint and receives
     * rendered HTML. Updates preview state for display.
     */
    const fetchPreview = async () => {
        setLoadingPreview(true);
        try {
            const response = await fetch('/api/admin/pages/preview', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                },
                body: JSON.stringify({ content })
            });

            if (!response.ok) {
                throw new Error(`Failed to generate preview: ${response.statusText}`);
            }

            const data = await response.json();
            setPreview(data.html);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate preview');
            setPreview('<p class="error">Failed to generate preview</p>');
        } finally {
            setLoadingPreview(false);
        }
    };

    /**
     * Save page (create or update).
     *
     * Sends POST for new pages or PATCH for existing pages. Validates that
     * content is not empty before submitting. Calls onSave callback on success.
     */
    const savePage = async () => {
        if (!content.trim()) {
            setError('Content cannot be empty');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const isUpdate = !!page?._id;
            const url = isUpdate ? `/api/admin/pages/${page._id}` : '/api/admin/pages';
            const method = isUpdate ? 'PATCH' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                },
                body: JSON.stringify({ content })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || `Failed to save page: ${response.statusText}`);
            }

            onSave();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save page');
        } finally {
            setSaving(false);
        }
    };

    // Load preview when showing preview pane or content changes (debounced)
    useEffect(() => {
        if (!showPreview) return;

        // Debounce preview updates to avoid excessive API calls
        const timeoutId = setTimeout(() => {
            void fetchPreview();
        }, 500); // Wait 500ms after user stops typing

        return () => clearTimeout(timeoutId);
    }, [showPreview, content]);

    return (
        <div className={styles.editor}>
            {/* Header */}
            <Card padding="md">
                <div className={styles.header}>
                    <h2 className={styles.title}>
                        {page ? `Edit: ${page.title}` : 'Create New Page'}
                    </h2>
                    <div className={styles.actions}>
                        <Button
                            variant="ghost"
                            size="md"
                            icon={<Eye size={18} />}
                            onClick={() => setShowPreview(!showPreview)}
                        >
                            {showPreview ? 'Hide Preview' : 'Show Preview'}
                        </Button>
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<X size={18} />}
                            onClick={onCancel}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            size="md"
                            icon={<Save size={18} />}
                            onClick={() => void savePage()}
                            loading={saving}
                        >
                            Save
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Error Display */}
            {error && (
                <Card tone="muted" padding="md">
                    <p className={styles.error}>{error}</p>
                </Card>
            )}

            {/* Editor Panes */}
            <div className={styles.panes}>
                {/* Markdown Editor */}
                <Card padding="md" className={styles.pane}>
                    <h3 className={styles.pane_title}>Markdown Editor</h3>
                    <textarea
                        className={styles.textarea}
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        placeholder="Enter markdown content with frontmatter..."
                        spellCheck={false}
                    />
                </Card>

                {/* Preview Pane */}
                {showPreview && (
                    <Card padding="md" className={styles.pane}>
                        <h3 className={styles.pane_title}>Preview</h3>
                        {loadingPreview ? (
                            <div className={styles.preview}>
                                <p style={{ color: 'var(--color-text-muted)' }}>Loading preview...</p>
                            </div>
                        ) : (
                            <div
                                className={styles.preview}
                                dangerouslySetInnerHTML={{ __html: preview }}
                            />
                        )}
                    </Card>
                )}
            </div>

            {/* Help Text */}
            <Card tone="muted" padding="sm">
                <p className={styles.help}>
                    <strong>Frontmatter:</strong> The YAML block at the top defines page metadata.
                    Required fields: <code>title</code>, <code>slug</code>.
                    Optional: <code>description</code>, <code>keywords</code>, <code>published</code>, <code>ogImage</code>.
                </p>
            </Card>
        </div>
    );
}
