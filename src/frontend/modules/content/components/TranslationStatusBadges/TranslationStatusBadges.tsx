'use client';

/**
 * @fileoverview A compact row showing an item's translations in an admin list.
 *
 * An operator deciding what to translate next needs to see, beside every item,
 * which languages exist, which are live, and which have fallen behind the
 * English. Opening each item's translation editor to find out does not scale
 * past a handful of items, so a content type's admin list renders this row
 * under each item instead. It shows state only, never translated text.
 */

import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import type { IContentTranslationStatus, ITranslationStatusBadgesProps } from '@/types';
import { Badge } from '../../../../components/ui/Badge';
import styles from './TranslationStatusBadges.module.scss';

/**
 * Describe one translation in words, for the badge's tooltip and for screen
 * readers, which cannot read the badge's colour.
 *
 * @param status - The translation's state.
 * @returns A short phrase such as "zh: published, English changed".
 */
function describeStatus(status: IContentTranslationStatus): string {
    const state = status.published ? 'published' : 'draft';

    return `${status.language}: ${state}${status.stale ? ', English changed' : ''}`;
}

/**
 * One badge per live translation: green when published and current, amber
 * when the English has changed since it was saved, neutral for a draft.
 * Deleted translations are left out, because a deleted translation is not
 * served and an operator scanning the list is asking what is.
 *
 * @param props - The item's translation statuses.
 * @returns The badge row, a "no translations" note, or nothing while loading.
 */
export function TranslationStatusBadges({ statuses }: ITranslationStatusBadgesProps) {
    const live = (statuses ?? []).filter((status) => !status.deleted);
    let content: ReactNode = null;
    if (statuses && live.length === 0) {
        content = <span className={styles.none}>No translations</span>;
    } else if (live.length > 0) {
        content = live.map((status) => {
            const tone = status.stale ? 'warning' : status.published ? 'success' : 'neutral';
            return (
                <Badge key={status.language} tone={tone} size="sm" title={describeStatus(status)} aria-label={describeStatus(status)}>
                    {status.stale && <AlertCircle size={12} aria-hidden="true" />}
                    {status.language.toUpperCase()}
                </Badge>
            );
        });
    }

    return statuses === undefined ? null : (
        <div className={styles.row}>
            <span className={styles.label}>Translations:</span>
            {content}
        </div>
    );
}
