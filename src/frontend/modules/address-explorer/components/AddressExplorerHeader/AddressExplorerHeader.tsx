'use client';

/**
 * @fileoverview The top of the `/a/<address>` page, shown to every visitor.
 *
 * Signed in or not, a visitor sees which address the page is about, can copy
 * it, and can open it on Tronscan. The Tronscan link lives here because the
 * site's address chips now open this page instead of Tronscan, so this is
 * where a visitor who wanted Tronscan finds it, without having to sign in.
 */

import { ExternalLink } from 'lucide-react';
import { PageHeader } from '../../../../components/layout';
import { CopyButton } from '../../../../components/ui/CopyButton';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import styles from './AddressExplorerHeader.module.scss';

/** Tronscan's page for an address; the address is appended. */
const TRONSCAN_ADDRESS_URL = 'https://tronscan.org/#/address/';

/** Props for {@link AddressExplorerHeader}. */
export interface IAddressExplorerHeaderProps {
    /** The base58 address the page is about. */
    address: string;
}

/**
 * Render the page title, the full address with a copy button, and the Tronscan link.
 *
 * @param props - {@link IAddressExplorerHeaderProps}.
 * @returns The page header.
 */
export function AddressExplorerHeader({ address }: IAddressExplorerHeaderProps) {
    const { t } = useTranslation();
    return (
        <PageHeader
            title={t('addressExplorer.title', 'Address')}
            subtitle={
                <span className={styles.address_row}>
                    <code className={styles.address}>{address}</code>
                    <CopyButton
                        value={address}
                        variant="ghost"
                        size="xs"
                        label={t('addressExplorer.copy', 'Copy')}
                        copiedLabel={t('addressExplorer.copied', 'Copied')}
                        aria-label={t('addressExplorer.copyAddress', 'Copy address')}
                    />
                </span>
            }
        >
            <a
                className={styles.tronscan_link}
                href={`${TRONSCAN_ADDRESS_URL}${address}`}
                target="_blank"
                rel="noopener noreferrer"
            >
                {t('addressExplorer.viewOnTronscan', 'View on Tronscan')}
                <ExternalLink size={14} aria-hidden="true" />
            </a>
        </PageHeader>
    );
}
