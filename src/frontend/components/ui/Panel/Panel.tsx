/**
 * Panel — one titled section of a data page, drawn as a single card.
 *
 * Data pages kept wrapping every section in a card and then drawing a second
 * bordered box around each figure inside it, so the page read as boxes inside
 * boxes with most of its area spent on borders and padding. A panel is the one
 * level of containment a section gets: a header row carrying the title, a short
 * line of context, and any controls, then the content with nothing framed
 * inside it.
 *
 * The header row exists so a fact every row in the section shares — the date
 * range, the sample size, a pager — is stated once beside the title rather than
 * repeated in each row or stacked as a separate line above the content.
 *
 * First built in the resource-markets plugin for its market detail page and
 * moved into core unchanged apart from taking `Card` directly instead of from
 * the plugin context.
 *
 * @module components/ui/Panel
 */

import type { IPanelProps } from '@/types';
import { cn } from '../../../lib/cn';
import { Card } from '../Card';
import styles from './Panel.module.scss';

/**
 * Render a section card with a single header row.
 *
 * Composes `Card` so the panel takes the active theme's surface, border, and
 * radius, and declares itself a size container so content inside it can
 * respond to the panel's width rather than the page's.
 *
 * @param props - Title and optional heading level, meta line, actions, tone,
 *        anchor id, class name, and content, as described on `IPanelProps`.
 * @returns The panel.
 *
 * @example
 * ```tsx
 * <Panel title="Recent rentals" meta="Last 7 days" actions={<Pager />}>
 *     <Table variant="compact">…</Table>
 * </Panel>
 * ```
 */
export function Panel({
    title,
    titleAs: Heading = 'h2',
    meta,
    actions,
    tone = 'default',
    id,
    className,
    children
}: IPanelProps) {
    return (
        <Card padding="sm" tone={tone} className={cn(styles.panel, className)}>
            <section id={id} className={styles.section}>
                <header className={styles.header}>
                    <Heading className={styles.title}>{title}</Heading>
                    {meta && <p className={styles.meta}>{meta}</p>}
                    {actions && <div className={styles.actions}>{actions}</div>}
                </header>
                {children}
            </section>
        </Card>
    );
}
