/**
 * ClickHouseNotice Component
 *
 * The warning both Crawlers-tab dashboards show when the deployment has no
 * ClickHouse connection, so traffic events are not being recorded.
 *
 * Without it, every panel on the tab reports zero rows, which reads as "no
 * crawler traffic" rather than "nothing is being measured".
 */

import { AlertTriangle } from 'lucide-react';
import styles from './ClickHouseNotice.module.scss';

interface IClickHouseNoticeProps {
    /** What reports zero rows as a result, named in the message so the reader knows the scope. */
    affected: string;
}

/**
 * Render the not-configured warning.
 *
 * @param props - The name of the panels that report zero rows as a result.
 * @returns The warning line.
 */
export function ClickHouseNotice({ affected }: IClickHouseNoticeProps) {
    return (
        <div className={styles.notice} role="status">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
                ClickHouse is not configured on this deployment. Traffic events are not being
                recorded, so {affected} report zero rows.
            </span>
        </div>
    );
}
