'use client';

/**
 * @fileoverview Small presentational primitives shared by the wallet-detail
 * panels.
 *
 * Section framing used to live here too (a titled card and a local stat tile),
 * but every panel now uses the core `Panel`, `FigureList`, and `StatTile`
 * components instead, so only the address renderer the counterparty table and
 * the transaction feed share remains.
 */

import { Tooltip } from '../../../../../components/ui/Tooltip';
import { truncateAddress } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/**
 * Props for {@link AddressDisplay}.
 */
interface IAddressDisplayProps {
    /** The full base58 address. */
    address: string;
    /** Human-friendly label resolved by the address-labels service, if any. */
    label?: string;
}

/**
 * Render a TRON address label-first: when the backend resolved a human-friendly
 * name (an exchange, a pool) show that name, otherwise the truncated monospace
 * address. The full address always lives in the tooltip so labeling never
 * hides the underlying identity users may need to verify.
 *
 * @param props - {@link IAddressDisplayProps}.
 * @returns The labeled or truncated address with a full-address tooltip.
 */
export function AddressDisplay({ address, label }: IAddressDisplayProps) {
    return (
        <Tooltip content={address}>
            {label
                ? <span className={styles.address_label}>{label}</span>
                : <span className={styles.address}>{truncateAddress(address)}</span>}
        </Tooltip>
    );
}
