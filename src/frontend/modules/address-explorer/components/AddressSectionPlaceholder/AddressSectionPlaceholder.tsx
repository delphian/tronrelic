'use client';

/**
 * @fileoverview What a section of the address page shows until it streams in.
 *
 * The server sends the page straight away and adds each section as its chain
 * read finishes. Until then the section's place holds this: a panel with the
 * section's real title, so the page's headings never change under the reader,
 * and a few shimmering bars that say its content is on the way.
 */

import { Panel } from '../../../../components/ui/Panel';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { sectionTitle, type AddressExplorerSectionName } from '../../lib/sectionTitle';
import styles from './AddressSectionPlaceholder.module.scss';

/** Props for {@link AddressSectionPlaceholder}. */
export interface IAddressSectionPlaceholderProps {
    /** The section that will replace this placeholder. */
    section: AddressExplorerSectionName;
}

/**
 * Render a section's loading placeholder.
 *
 * @param props - {@link IAddressSectionPlaceholderProps}.
 * @returns A panel titled for the section, with loading bars in place of its content.
 */
export function AddressSectionPlaceholder({ section }: IAddressSectionPlaceholderProps) {
    const { t } = useTranslation();

    return (
        <Panel title={sectionTitle(t, section)} titleAs="h2" meta={t('addressExplorer.loading', 'Loading…')}>
            <div className={styles.bars} aria-hidden="true">
                <Skeleton />
                <Skeleton />
                <Skeleton />
            </div>
        </Panel>
    );
}
