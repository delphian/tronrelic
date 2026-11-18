/**
 * @fileoverview The name-and-description block that opens a row in the
 * notification tables.
 *
 * The Categories, Channels, History, and preference tables all lead each row
 * with a bold name and a muted line explaining it. Drawing that block in one
 * place keeps the four tables reading the same, and gives the History feed a
 * single switch for holding a long notification body to one line.
 */

import { cn } from '../../../lib/cn';
import styles from './RowLabel.module.scss';

/** Props for {@link RowLabel}. */
interface IRowLabelProps {
    /** The row's name, such as a category label or a notification title. */
    name: string;
    /** The muted line under the name; omitted when the row has none. */
    description?: string;
    /**
     * Hold the description to one line and show the full text on hover. Set
     * for free text of unknown length, such as a notification body, so one
     * long entry cannot make its row several times taller than the rest.
     * @default false
     */
    clamp?: boolean;
    /** Hover text for the name, for a detail the table has no column for, such as a channel id. */
    nameTitle?: string;
}

/**
 * Render a row's name with its muted description under it.
 *
 * @param props - The name, the optional description, whether to clamp it, and the name's hover text.
 * @returns The two-line label block.
 */
export function RowLabel({ name, description, clamp = false, nameTitle }: IRowLabelProps) {
    return (
        <div className={styles.row_label}>
            <div className={styles.name} title={nameTitle}>{name}</div>
            {description && (
                <div
                    className={cn(styles.description, clamp && styles.description_clamped)}
                    title={clamp ? description : undefined}
                >
                    {description}
                </div>
            )}
        </div>
    );
}
