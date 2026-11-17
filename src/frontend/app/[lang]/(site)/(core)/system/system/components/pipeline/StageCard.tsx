'use client';

/**
 * @fileoverview Shared shell for the Pipeline tab's stage cards.
 *
 * Each stage of the pipeline — Fetch, Enrich, Buffer, Commit, and the Chain
 * data copy — gets a panel with the same header: the stage name and the
 * control that acts on it, then one sentence saying what the stage does, so a
 * control sits beside the figures it affects. The header is the shared
 * `Panel` header, so the stage cards and the table panels under them read as
 * one set.
 *
 * The sentence sits under the header rather than in the header's context
 * slot. A stage card is half the tab wide, and a sentence beside the title
 * there pushed the stage's control onto a line of its own.
 */

import type { ReactNode } from 'react';
import { Panel } from '../../../../../../../../components/ui/Panel';
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
 * @returns The panel.
 */
export function StageCard({ title, description, actions, children }: IStageCardProps) {
    return (
        <Panel title={title} titleAs="h3" actions={actions} className={styles.card}>
            <p className={styles.description}>{description}</p>
            {children}
        </Panel>
    );
}
