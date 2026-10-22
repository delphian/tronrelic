'use client';

/**
 * @fileoverview Body of the toast shown after an AI translation request.
 *
 * The administrator reviews suggested text before saving it, so they need what
 * the model said alongside it: its remarks on the batch, its notes on specific
 * items, which items it skipped, and what the run cost. Both the localization
 * Translations tab and the page translation editor on `/system/pages` show
 * this same body, so a suggestion reads the same wherever it was requested.
 *
 * @module modules/localization/components/admin/SuggestionSummary
 */

import styles from './LocalizationAdmin.module.scss';

/** Per-item notes listed before the rest are summarised as a count. */
const MAX_LISTED_NOTES = 5;

/** One item's note from the model, such as a key it was unsure how to translate. */
interface ISuggestionItemNote {
    /** Stable id for the list key. */
    id: string;
    /** What the note is about, shown in monospace, such as a translation key. */
    label: string;
    /** The model's remark. */
    note: string;
}

/** Props for {@link SuggestionSummary}. */
interface ISuggestionSummaryProps {
    /** The model's general remarks, or null when it had none. */
    notes: string | null;
    /** The model's notes on individual items; omit for a single-item request. */
    itemNotes?: ISuggestionItemNote[];
    /** Labels of requested items the model returned nothing usable for. */
    unanswered?: string[];
    /** Cost the provider reported, or null when it could not price the run. */
    costUsd: number | null;
    /** Model that answered. */
    model: string;
    /** Tokens sent to and received from the model. */
    usage: { inputTokens: number; outputTokens: number };
}

/**
 * Format a dollar cost so a fraction of a cent still shows a figure rather
 * than rounding to $0.00, which would hide what the runs add up to.
 *
 * @param costUsd - Cost reported by the provider, or null when it could not price the run.
 * @returns The cost as display text.
 */
export function formatSuggestionCost(costUsd: number | null): string {
    let text = 'cost not reported by the provider';
    if (costUsd !== null) {
        text = costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
    }
    return text;
}

/**
 * Render the model's remarks, its per-item notes, any skipped items, and the
 * cost line.
 *
 * @param props - What the suggestion request returned.
 * @returns The toast description.
 */
export function SuggestionSummary({ notes, itemNotes = [], unanswered = [], costUsd, model, usage }: ISuggestionSummaryProps) {
    const hidden = itemNotes.length - MAX_LISTED_NOTES;

    return (
        <div className={styles.suggestion_summary}>
            {notes && <p className={styles.suggestion_text}>{notes}</p>}
            {itemNotes.length > 0 && (
                <ul className={styles.suggestion_notes}>
                    {itemNotes.slice(0, MAX_LISTED_NOTES).map(item => (
                        <li key={item.id}>
                            <span className={styles.mono}>{item.label}</span>: {item.note}
                        </li>
                    ))}
                    {hidden > 0 && <li>{hidden} more {hidden === 1 ? 'note' : 'notes'} on the page</li>}
                </ul>
            )}
            {unanswered.length > 0 && (
                <p className={styles.suggestion_text}>
                    No suggestion for {unanswered.join(', ')}.
                </p>
            )}
            <p className={styles.suggestion_cost}>
                {formatSuggestionCost(costUsd)} · {model} · {usage.inputTokens.toLocaleString()} in /{' '}
                {usage.outputTokens.toLocaleString()} out tokens
            </p>
        </div>
    );
}
