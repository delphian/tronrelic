/**
 * Create label form component.
 *
 * Provides form interface for creating new address labels
 * with all required and optional fields.
 */

import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { CATEGORIES, SOURCE_TYPES, type CreateLabelFormState } from './types';
import styles from '../page.module.css';

interface CreateLabelFormProps {
    form: CreateLabelFormState;
    loading: boolean;
    onFormChange: (form: CreateLabelFormState) => void;
    onCreate: () => void;
    onCancel: () => void;
}

/**
 * Form for creating new address labels.
 */
export function CreateLabelForm({
    form,
    loading,
    onFormChange,
    onCreate,
    onCancel
}: CreateLabelFormProps) {
    return (
        <Card padding="lg">
            <h2 className={styles.formTitle}>Create New Label</h2>
            <div className={styles.formGrid}>
                <div className={styles.formField}>
                    <label>Address *</label>
                    <input
                        type="text"
                        value={form.address}
                        onChange={e => onFormChange({ ...form, address: e.target.value })}
                        placeholder="T..."
                        className={styles.input}
                    />
                </div>
                <div className={styles.formField}>
                    <label>Label *</label>
                    <input
                        type="text"
                        value={form.label}
                        onChange={e => onFormChange({ ...form, label: e.target.value })}
                        placeholder="e.g., Binance Hot Wallet"
                        className={styles.input}
                    />
                </div>
                <div className={styles.formField}>
                    <label>Category</label>
                    <select
                        value={form.category}
                        onChange={e => onFormChange({ ...form, category: e.target.value })}
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
                        value={form.sourceType}
                        onChange={e => onFormChange({ ...form, sourceType: e.target.value })}
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
                        value={form.tags}
                        onChange={e => onFormChange({ ...form, tags: e.target.value })}
                        placeholder="cex, hot-wallet"
                        className={styles.input}
                    />
                </div>
                <div className={styles.formField}>
                    <label>Confidence (0-100)</label>
                    <input
                        type="number"
                        value={form.confidence}
                        onChange={e => {
                            const value = parseInt(e.target.value, 10);
                            onFormChange({ ...form, confidence: isNaN(value) ? 50 : value });
                        }}
                        min={0}
                        max={100}
                        className={styles.input}
                    />
                </div>
                <div className={styles.formFieldFull}>
                    <label>Notes</label>
                    <textarea
                        value={form.notes}
                        onChange={e => onFormChange({ ...form, notes: e.target.value })}
                        placeholder="Additional context..."
                        className={styles.textarea}
                    />
                </div>
                <div className={styles.formFieldFull}>
                    <label className={styles.checkbox}>
                        <input
                            type="checkbox"
                            checked={form.verified}
                            onChange={e => onFormChange({ ...form, verified: e.target.checked })}
                        />
                        <span>Verified</span>
                    </label>
                </div>
            </div>
            <div className={styles.formActions}>
                <Button variant="secondary" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    onClick={onCreate}
                    loading={loading}
                    disabled={!form.address || !form.label}
                >
                    Create Label
                </Button>
            </div>
        </Card>
    );
}
