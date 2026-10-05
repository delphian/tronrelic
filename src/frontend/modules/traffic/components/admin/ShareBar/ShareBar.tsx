/**
 * ShareBar Component
 *
 * A thin horizontal bar showing one value's share of the largest value in the
 * same list, drawn inside a table cell or a bar list beside the figure it
 * illustrates.
 *
 * The traffic tables used to give the bar a column of its own, which cost a
 * column of width in every table and pushed the figure and its bar apart. The
 * bar now sits directly beside the figure, so a reader sees the number and its
 * relative size together. It draws with the shared meter tokens, so it matches
 * every other meter on the site and follows the active theme.
 */

import styles from './ShareBar.module.scss';

interface IShareBarProps {
    /** The row's value. */
    value: number;
    /**
     * The largest value in the list, which fills the bar completely. The
     * caller passes it so every bar in one list is drawn against the same
     * scale.
     */
    max: number;
    /**
     * Fill the width the parent gives the bar instead of holding the fixed
     * table length. Only safe where every bar in the list gets the same width,
     * such as one shared grid column, because the fills compare only when the
     * tracks are the same length.
     * @default false
     */
    fluid?: boolean;
}

/**
 * Render the bar track with its fill sized to `value / max`.
 *
 * The bar is decorative, because the figure beside it already carries the
 * number, so it is hidden from assistive technology.
 *
 * @param props - The row's value, the list maximum it is measured against, and
 *   whether the track stretches to its parent's width.
 * @returns The bar element.
 */
export function ShareBar({ value, max, fluid = false }: IShareBarProps) {
    const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
    return (
        <span className={fluid ? `${styles.track} ${styles.track_fluid}` : styles.track} aria-hidden="true">
            <span className={styles.fill} style={{ width: `${percent}%` }} />
        </span>
    );
}
