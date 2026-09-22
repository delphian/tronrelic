'use client';

/**
 * @fileoverview The log viewer's severity filter, which doubles as its level
 * counts.
 *
 * The viewer used to show seven stat tiles above a separate row of
 * checkboxes, so the same six levels appeared twice and took most of the
 * space above the list. Here each level is one toggle chip carrying its count,
 * which answers "how many errors are there" and "show me the errors" in the
 * same place.
 */

import type { LogLevel } from '@/types';
import { cn } from '../../../../lib/cn';
import { LOG_LEVELS_BY_SEVERITY, levelLabel, levelTone } from '../../lib/logPresentation';
import styles from './LogLevelFilter.module.scss';

/** Props for {@link LogLevelFilter}. */
interface ILogLevelFilterProps {
    /** Levels currently shown in the list; an empty list means every level. */
    selected: LogLevel[];
    /**
     * Entry count per level, from the stats endpoint. Missing while the first
     * stats read is in flight, in which case the chips show no counts.
     */
    counts?: Partial<Record<LogLevel, number>>;
    /** Called with the level the operator toggled. */
    onToggle: (level: LogLevel) => void;
}

/**
 * Severity toggle chips with per-level counts.
 *
 * Each chip is a toggle button (`aria-pressed`), so keyboard and screen reader
 * users get the same on/off state the colour shows. A level with no entries
 * stays selectable but is drawn quieter, so the eye goes to levels that have
 * something in them.
 *
 * @param props - See {@link ILogLevelFilterProps}.
 * @returns The chip row.
 */
export function LogLevelFilter({ selected, counts, onToggle }: ILogLevelFilterProps) {
    return (
        <div className={styles.chips} role="group" aria-label="Show severity levels">
            {LOG_LEVELS_BY_SEVERITY.map(level => {
                const pressed = selected.includes(level);
                const count = counts?.[level];
                const empty = count === 0;
                return (
                    <button
                        key={level}
                        type="button"
                        aria-pressed={pressed}
                        className={cn(
                            styles.chip,
                            styles[`tone_${levelTone(level)}`],
                            pressed && styles.chip_on,
                            empty && !pressed && styles.chip_empty
                        )}
                        onClick={() => onToggle(level)}
                    >
                        <span className={styles.dot} aria-hidden="true" />
                        <span className={styles.label}>{levelLabel(level)}</span>
                        {count !== undefined && <span className={styles.count}>{count.toLocaleString()}</span>}
                    </button>
                );
            })}
        </div>
    );
}
