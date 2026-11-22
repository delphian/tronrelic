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
import { AlertCircle, Check, Inbox } from 'lucide-react';
import type { IContentTranslationStatus, ITranslationStatusBadgesProps } from '@/types';
import { Badge } from '../../../../components/ui/Badge';
import styles from './TranslationStatusBadges.module.scss';

/**
 * Describe one translation in words, such as "zh: published, English changed",
 * for the badge's tooltip and for screen readers, which cannot read its colour.
 * A language with only a proposal reads "zh: proposed, waiting for review", and
 * a custom version reads "ru: published, custom, does not track the English".
 * `saved` is compared with `false` so a status from a server that predates
 * proposals, which carries no `saved` field, still reads as a saved translation.
 */
function describeStatus(status: IContentTranslationStatus): string {
    const state = status.saved === false ? 'proposed' : status.published ? 'published' : 'draft';
    const notes = [
        ...(status.custom ? ['custom, does not track the English'] : []),
        ...(status.stale ? ['English changed'] : []),
        ...(status.proposalPending ? [status.saved === false ? 'waiting for review' : 'proposal waiting for review'] : [])
    ];

    return `${status.language}: ${state}${notes.length > 0 ? `, ${notes.join(', ')}` : ''}`;
}

/**
 * One badge per live translation: green when published and current, amber
 * when the English has changed since it was saved, neutral for a draft, and
 * blue for a language that has only a proposal waiting for review. A custom
 * version carries a tick and is never amber, because it does not track the
 * English. A saved translation with a proposal waiting carries an inbox icon,
 * so an operator sees where review work is waiting without opening each item. Deleted
 * translations are left out, because a deleted translation is not served and
 * an operator scanning the list is asking what is.
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
            const tone = status.saved === false ? 'info' : status.stale ? 'warning' : status.published ? 'success' : 'neutral';
            return (
                <Badge key={status.language} tone={tone} size="sm" title={describeStatus(status)} aria-label={describeStatus(status)}>
                    {status.custom && <Check size={12} aria-hidden="true" />}
                    {status.stale && <AlertCircle size={12} aria-hidden="true" />}
                    {status.proposalPending && <Inbox size={12} aria-hidden="true" />}
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
