/**
 * Label card component.
 *
 * Displays a single address label with edit and delete capabilities.
 * Supports inline editing mode for quick updates.
 */

import { Edit, Trash2, Check, X, Tag } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { CATEGORIES, type AddressLabel } from './types';
import styles from '../page.module.css';

interface LabelCardProps {
    label: AddressLabel;
    isEditing: boolean;
    editForm: Partial<AddressLabel>;
    onEdit: () => void;
    onEditChange: (form: Partial<AddressLabel>) => void;
    onSave: () => void;
    onCancelEdit: () => void;
    onDelete: () => void;
}

/**
 * Individual label card with display and edit modes.
 */
export function LabelCard({
    label,
    isEditing,
    editForm,
    onEdit,
    onEditChange,
    onSave,
    onCancelEdit,
    onDelete
}: LabelCardProps) {
    if (isEditing) {
        return (
            <div className={styles.labelCard}>
                <div className={styles.editForm}>
                    <input
                        type="text"
                        value={editForm.label ?? label.label}
                        onChange={e => onEditChange({ ...editForm, label: e.target.value })}
                        className={styles.input}
                    />
                    <select
                        value={editForm.category ?? label.category}
                        onChange={e => onEditChange({ ...editForm, category: e.target.value })}
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
                            onClick={onCancelEdit}
                            aria-label="Cancel edit"
                        >
                            <X size={16} />
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={onSave}
                            aria-label="Save changes"
                        >
                            <Check size={16} />
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.labelCard}>
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
                        onClick={onEdit}
                        aria-label="Edit label"
                    >
                        <Edit size={14} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onDelete}
                        aria-label="Delete label"
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
        </div>
    );
}
