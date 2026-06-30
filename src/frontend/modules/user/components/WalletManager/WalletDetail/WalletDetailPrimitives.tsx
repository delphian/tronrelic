'use client';

/**
 * @fileoverview Small presentational primitives shared by the wallet-detail
 * panels: a titled section wrapper and a labelled stat tile.
 *
 * Several panels (activity stats, resource totals) render the same "labelled
 * value in a card, grouped in a responsive grid" shape, and every panel wants
 * the same icon-plus-title header. Extracting both keeps the panels declarative
 * and guarantees one consistent visual rhythm across the detail view rather than
 * each panel re-deriving headers and tiles.
 */

import type { ReactNode } from 'react';
import { Card } from '../../../../../components/ui/Card';
import styles from './WalletDetail.module.scss';

/**
 * Props for {@link WalletDetailSection}.
 */
interface IWalletDetailSectionProps {
    /** Leading icon for the section header. */
    icon: ReactNode;
    /** Section title. */
    title: string;
    /** Section body. */
    children: ReactNode;
}

/**
 * A titled card section — the consistent container every detail panel sits in.
 *
 * @param props - {@link IWalletDetailSectionProps}.
 * @returns A card with an icon/title header and the panel body.
 */
export function WalletDetailSection({ icon, title, children }: IWalletDetailSectionProps) {
    return (
        <Card padding="md">
            <div className={styles.section_header}>
                {icon}
                <h3 className={styles.section_title}>{title}</h3>
            </div>
            {children}
        </Card>
    );
}

/**
 * Props for {@link StatTile}.
 */
interface IStatTileProps {
    /** Short uppercase label describing the metric. */
    label: string;
    /** The metric value, already formatted. */
    value: ReactNode;
    /** Optional leading icon shown beside the label. */
    icon?: ReactNode;
}

/**
 * One labelled metric tile, composing the global `stat-card__*` utilities inside
 * a muted card so a grid of these reads as a stat strip.
 *
 * @param props - {@link IStatTileProps}.
 * @returns A stat tile card.
 */
export function StatTile({ label, value, icon }: IStatTileProps) {
    return (
        <Card padding="sm" tone="muted">
            <span className={`stat-card__label ${styles.tile_label}`}>
                {icon}
                {label}
            </span>
            <div className="stat-card__value">{value}</div>
        </Card>
    );
}
