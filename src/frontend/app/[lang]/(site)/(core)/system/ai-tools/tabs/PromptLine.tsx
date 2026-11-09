'use client';

/**
 * @file PromptLine.tsx
 *
 * The operator's line on the Query tab, drawn the way a command-line agent
 * draws it: a `›` prompt glyph in the gutter and the text beside it in a
 * monospace face. The same component draws both a sent message in the
 * transcript and the live composer field, so the line the operator types looks
 * the same once it has been sent and moves up into the history. Keeping the
 * look in one place is what stops the two from drifting apart.
 */

import type { ReactNode } from 'react';
import styles from './PromptLine.module.scss';

/** Props for {@link PromptLine}. */
export interface IPromptLineProps {
    /** The line's content: a sent message's text, or the composer's field. */
    children: ReactNode;
    /** Extra class for layout the caller owns, such as the composer's spacing. */
    className?: string;
}

/**
 * Draw one operator line with its prompt glyph. The glyph is hidden from
 * assistive technology because it is decoration; the surrounding article or
 * the field's own label already says whose line it is.
 *
 * @param props - See {@link IPromptLineProps}.
 * @returns The prompt line wrapping the supplied content.
 */
export function PromptLine({ children, className }: IPromptLineProps) {
    return (
        <div className={className ? `${styles.line} ${className}` : styles.line}>
            <span className={styles.glyph} aria-hidden="true">›</span>
            <div className={styles.body}>{children}</div>
        </div>
    );
}
