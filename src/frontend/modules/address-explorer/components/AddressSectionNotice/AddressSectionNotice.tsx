'use client';

/**
 * @fileoverview The one-line notices a section of the address page can need.
 *
 * Every section shares the same frame, so the same three situations can arise
 * in any of them: the read failed, a 21-day read was narrowed to 7 days, or
 * part of the window is missing from the stored chain data. Writing those
 * messages once keeps their wording identical across sections, and keeps a
 * reader from mistaking an empty table over a gap for a quiet wallet.
 */

import type { AddressExplorerErrorReason, AddressExplorerSection } from '@/types';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import styles from './AddressSectionNotice.module.scss';

/** Props for {@link AddressSectionNotice}. */
export interface IAddressSectionNoticeProps {
    /** The section to describe. */
    section: AddressExplorerSection<unknown>;
    /**
     * Which coverage flag decides that the window is complete. Sections built
     * from transfers need block receipts as well as blocks; delegations and
     * permission changes need blocks only.
     */
    coverageField: 'complete' | 'blocksComplete';
    /** Reloads the section; offered for failures a retry can fix. */
    onRetry?: () => void;
}

/** Failures a retry soon afterwards can fix. */
const RETRYABLE: ReadonlySet<AddressExplorerErrorReason> = new Set(['busy', 'failed', 'unavailable']);

/**
 * Render the notice a section needs, or nothing when it needs none.
 *
 * @param props - {@link IAddressSectionNoticeProps}.
 * @returns The notice, or null.
 */
export function AddressSectionNotice({ section, coverageField, onRetry }: IAddressSectionNoticeProps) {
    const { t } = useTranslation();
    let notice = null;

    if (section.status === 'error') {
        const messages: Record<AddressExplorerErrorReason, string> = {
            'too-large': t('addressExplorer.error.tooLarge', 'This wallet is too active to read over this span. Choose a shorter one.'),
            quota: t('addressExplorer.error.quota', 'You have reached your hourly limit for address lookups. Try again later.'),
            busy: t('addressExplorer.error.busy', 'Address lookups are busy right now. Try again in a moment.'),
            unavailable: t('addressExplorer.error.unavailable', 'Chain data cannot be read right now.'),
            failed: t('addressExplorer.error.failed', 'This section could not be loaded.')
        };
        notice = (
            <div className={`${styles.notice} ${styles['notice--warning']}`} role="status">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{messages[section.reason]}</span>
                {onRetry && RETRYABLE.has(section.reason) && (
                    <Button variant="secondary" size="xs" onClick={() => onRetry()}>
                        {t('addressExplorer.error.retry', 'Retry')}
                    </Button>
                )}
            </div>
        );
    } else {
        const lines: string[] = [];
        if (section.narrowedFrom) {
            lines.push(t('addressExplorer.notice.narrowed', 'This wallet is too active to read over 21 days, so this section shows the last 7 days.'));
        }
        if (section.coverage.presentBlocks === 0) {
            lines.push(t('addressExplorer.notice.noData', 'No chain data is stored for this span, so an empty list says nothing about activity.'));
        } else if (!section.coverage[coverageField]) {
            lines.push(t('addressExplorer.notice.incomplete', 'Some blocks in this span are missing from our copy of the chain, so counts and totals may be low.'));
        }
        if (lines.length > 0) {
            notice = (
                <div className={styles.notice}>
                    <Info size={14} aria-hidden="true" />
                    <span>{lines.join(' ')}</span>
                </div>
            );
        }
    }

    return notice;
}
