'use client';

/**
 * @fileoverview The held content, shown as a proof: the text and media set the
 * way a reader will meet them, followed by any labelled fields. Core knows
 * nothing about the underlying payload; the owning content type flattened it
 * into this generic descriptor. Used both for the item under review and for
 * the content as it was decided, in the History record.
 */

import { useCallback, useState } from 'react';
import { Button } from '../../../../../../../components/ui/Button';
import type { ICurationItemView } from '../../../../../../../modules/curation';
import styles from './CurationPreview.module.scss';

/**
 * Body length past which the text collapses behind a "Show full text" toggle,
 * so a long draft does not push the decision area far below the fold.
 */
const COLLAPSE_AT = 600;

/**
 * Shorten text to a limit for the collapsed view.
 *
 * @param text - The full body text.
 * @param max - The number of characters to keep.
 * @returns The text, cut at the limit with an ellipsis when it was longer.
 */
function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * Render one held item's content.
 *
 * The summary is shown on its own, labelled, whenever it differs from the
 * body, because it is the text short-form publish sinks such as X and
 * Telegram send in place of the body. Approving the item approves that text
 * too, so the curator has to be able to read it. When the summary repeats the
 * body, as it does for a short social post, it is not shown twice.
 *
 * @param props.preview - The content descriptor from the curation envelope.
 * @returns The proof and its fields.
 */
export function CurationPreview({ preview }: { preview: ICurationItemView['preview'] }) {
    const [expanded, setExpanded] = useState(false);
    const body = preview.body ?? '';
    const summary = preview.summary ?? '';
    const showSummary = summary.length > 0 && summary !== body;
    const isLong = body.length > COLLAPSE_AT;
    const shownBody = expanded || !isLong ? body : clip(body, COLLAPSE_AT);
    const image = preview.media?.find(media => media.kind !== 'link');
    const fields = preview.details ?? [];

    /** Switch between the collapsed and the full body text. */
    const toggleExpanded = useCallback(() => { setExpanded(previous => !previous); }, []);

    return (
        <div className={styles.preview}>
            {showSummary && (
                <div className={styles.summary}>
                    <span className={styles.summary_label}>Summary sent to short-form channels</span>
                    <p className={styles.summary_text}>{summary}</p>
                </div>
            )}

            {(body || image) ? (
                <div className={styles.proof}>
                    {body && <p className={styles.body}>{shownBody}</p>}
                    {isLong && (
                        <Button variant="ghost" size="xs" onClick={toggleExpanded} aria-expanded={expanded}>
                            {expanded ? 'Show less' : 'Show full text'}
                        </Button>
                    )}
                    {image && (
                        // A resolved public URL from the owning plugin; next/image
                        // adds nothing for an admin-only, externally sized image.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={image.url} alt={image.alt ?? 'Attached media'} className={styles.image} loading="lazy" />
                    )}
                </div>
            ) : !showSummary && (
                <p className={styles.empty}>This item has no text or media to show.</p>
            )}

            {fields.length > 0 && (
                <dl className={styles.fields}>
                    {fields.map((field, index) => (
                        <div key={`${field.label}-${index}`} className={styles.field}>
                            <dt>{field.label}</dt>
                            <dd>{field.value}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}
