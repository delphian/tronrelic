'use client';

/**
 * @fileoverview Shared shell for the Pipeline tab's four stage cards.
 *
 * Each stage of the pipeline — Fetch, Enrich, Buffer, Commit — gets a card
 * with the same header: the stage name, one sentence saying what the stage
 * does, and the control that acts on it. The old console put controls far
 * from the figures they affect (the receipts switch was the last card on the
 * Configuration tab), so each card now carries its own.
 */

import type { ReactNode } from 'react';
import { Card } from '../../../../../../components/ui/Card';
import { Stack } from '../../../../../../components/layout';
import styles from './StageCard.module.scss';

/** Inputs for a stage card. */
interface IStageCardProps {
    /** Stage name, matching the name the health banner uses. */
    title: string;
    /** One sentence saying what this stage does, for a reader new to the pipeline. */
    description: string;
    /** Control that acts on this stage, shown at the right of the header. */
    actions?: ReactNode;
    /** The stage's figures, ending with its timing table when it has one. */
    children: ReactNode;
}

/**
 * Render a stage card.
 *
 * @param props - Title, description, optional control, and the stage's figures.
 * @returns The card.
 */
export function StageCard({ title, description, actions, children }: IStageCardProps) {
    return (
        <Card padding="sm" noBackgroundImage className={styles.card}>
            <Stack gap="sm">
                <header className={styles.header}>
                    <div className={styles.heading}>
                        <h3 className={styles.title}>{title}</h3>
                        <p className={styles.description}>{description}</p>
                    </div>
                    {actions && <div className={styles.actions}>{actions}</div>}
                </header>
                {children}
            </Stack>
        </Card>
    );
}
