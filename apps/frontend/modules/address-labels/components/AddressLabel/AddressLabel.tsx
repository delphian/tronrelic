/**
 * AddressLabel Component
 *
 * Displays a TRON address with its human-readable label if available.
 * Fetches label data from the address labels API and caches results
 * in memory to avoid redundant requests.
 *
 * @example
 * ```tsx
 * // Basic usage - shows label if found, address otherwise
 * <AddressLabel address="TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH" />
 *
 * // With fallback to truncated address
 * <AddressLabel address="TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH" truncate />
 *
 * // Show both label and address
 * <AddressLabel address="TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH" showAddress />
 *
 * // Pre-resolved label (SSR-friendly)
 * <AddressLabel address="T..." label={{ label: 'Binance', category: 'exchange' }} />
 * ```
 */
'use client';

import { useState, useEffect } from 'react';
import { Tag, ExternalLink, CheckCircle } from 'lucide-react';
import type { ILabelData, IAddressLabelProps } from '../../types';
import { fetchLabel } from '../../api';
import styles from './AddressLabel.module.css';

/**
 * Truncate an address to show first and last characters.
 */
function truncateAddress(address: string, chars: number = 4): string {
    if (address.length <= chars * 2 + 3) {
        return address;
    }
    return `${address.slice(0, chars + 1)}...${address.slice(-chars)}`;
}

/**
 * Get category badge color.
 */
function getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
        exchange: 'var(--color-primary)',
        whale: 'var(--color-warning)',
        contract: 'var(--color-secondary)',
        institution: 'var(--color-success)',
        risk: 'var(--color-danger)',
        user: 'var(--color-text-muted)',
        unknown: 'var(--color-text-subtle)'
    };
    return colors[category] || colors.unknown;
}

/**
 * AddressLabel component.
 *
 * Displays a TRON address with its human-readable label if available.
 */
export function AddressLabel({
    address,
    label: initialLabel,
    truncate = false,
    showAddress = false,
    linkToExplorer = false,
    size = 'md',
    className
}: IAddressLabelProps) {
    const [label, setLabel] = useState<ILabelData | null>(initialLabel || null);
    const [loading, setLoading] = useState(!initialLabel);

    // Fetch label if not provided
    useEffect(() => {
        if (initialLabel !== undefined) {
            setLabel(initialLabel);
            setLoading(false);
            return;
        }

        let mounted = true;

        fetchLabel(address).then(result => {
            if (mounted) {
                setLabel(result);
                setLoading(false);
            }
        });

        return () => {
            mounted = false;
        };
    }, [address, initialLabel]);

    const displayAddress = truncate ? truncateAddress(address) : address;
    const explorerUrl = `https://tronscan.org/#/address/${address}`;

    const content = (
        <span
            className={`${styles.container} ${styles[`size_${size}`]} ${className || ''}`}
            title={label ? `${label.label} (${address})` : address}
        >
            {loading ? (
                <span className={styles.loading} />
            ) : label ? (
                <>
                    <Tag
                        size={size === 'sm' ? 12 : size === 'lg' ? 16 : 14}
                        style={{ color: getCategoryColor(label.category) }}
                        className={styles.icon}
                    />
                    <span className={styles.label}>{label.label}</span>
                    {label.verified && (
                        <CheckCircle
                            size={size === 'sm' ? 10 : 12}
                            className={styles.verified}
                        />
                    )}
                    {showAddress && (
                        <span className={styles.address}>
                            ({displayAddress})
                        </span>
                    )}
                </>
            ) : (
                <span className={styles.addressOnly}>
                    <code>{displayAddress}</code>
                </span>
            )}
            {linkToExplorer && (
                <ExternalLink
                    size={size === 'sm' ? 10 : 12}
                    className={styles.externalLink}
                />
            )}
        </span>
    );

    if (linkToExplorer) {
        return (
            <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
            >
                {content}
            </a>
        );
    }

    return content;
}
