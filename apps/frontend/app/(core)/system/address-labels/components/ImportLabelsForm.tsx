/**
 * Import labels form component.
 *
 * Provides interface for uploading JSON files containing
 * address labels for bulk import.
 */

import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import type { ImportResult } from './types';
import styles from '../page.module.css';

interface ImportLabelsFormProps {
    file: File | null;
    loading: boolean;
    result: ImportResult | null;
    onFileChange: (file: File | null) => void;
    onImport: () => void;
    onClose: () => void;
}

/**
 * Form for importing address labels from JSON files.
 */
export function ImportLabelsForm({
    file,
    loading,
    result,
    onFileChange,
    onImport,
    onClose
}: ImportLabelsFormProps) {
    return (
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
                    onChange={e => onFileChange(e.target.files?.[0] || null)}
                    className={styles.fileInput}
                />
                {file && (
                    <span className={styles.fileName}>{file.name}</span>
                )}
            </div>
            {result && (
                <div className={styles.importResult}>
                    <Badge tone="success">{result.imported} imported</Badge>
                    <Badge tone="neutral">{result.updated} updated</Badge>
                    {result.failed > 0 && (
                        <Badge tone="danger">{result.failed} failed</Badge>
                    )}
                    {result.errors.length > 0 && (
                        <div className={styles.importErrors}>
                            {result.errors.slice(0, 5).map((err, i) => (
                                <div key={i} className={styles.importError}>
                                    <code>{err.address}</code>: {err.error}
                                </div>
                            ))}
                            {result.errors.length > 5 && (
                                <div className={styles.importError}>
                                    ...and {result.errors.length - 5} more errors
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            <div className={styles.formActions}>
                <Button variant="secondary" onClick={onClose}>
                    Close
                </Button>
                <Button
                    variant="primary"
                    onClick={onImport}
                    loading={loading}
                    disabled={!file}
                >
                    Import
                </Button>
            </div>
        </Card>
    );
}
