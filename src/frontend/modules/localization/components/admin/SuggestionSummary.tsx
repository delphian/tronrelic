'use client';

/**
 * @fileoverview Body of the toast shown after an AI translation request.
 *
 * The administrator reviews suggested text before saving it, so they need what
 * the model said alongside it: its remarks on the batch, its notes on specific
 * keys, which keys it skipped, and what the run cost. Kept as its own
 * component so the Translations tab only decides when to show it.
 *
 * @module modules/localization/components/admin/SuggestionSummary
 */

import type { ITranslationSuggestionResult } from '@/types';
import styles from './LocalizationAdmin.module.scss';

/** Per-key notes listed before the rest are summarised as a count. */
const MAX_LISTED_NOTES = 5;

/** Props for {@link SuggestionSummary}. */
interface ISuggestionSummaryProps {
    /** What the suggestion request returned. */
    result: ITranslationSuggestionResult;
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
 * Render the model's remarks, its per-key notes, any skipped keys, and the
 * cost line.
 *
 * @param props - The suggestion result.
 * @returns The toast description.
 */
export function SuggestionSummary({ result }: ISuggestionSummaryProps) {
    const noted = result.suggestions.filter(suggestion => suggestion.note !== null);
    const hidden = noted.length - MAX_LISTED_NOTES;

    return (
        <div className={styles.suggestion_summary}>
            {result.notes && <p className={styles.suggestion_text}>{result.notes}</p>}
            {noted.length > 0 && (
                <ul className={styles.suggestion_notes}>
                    {noted.slice(0, MAX_LISTED_NOTES).map(suggestion => (
                        <li key={`${suggestion.namespace}:${suggestion.key}`}>
                            <span className={styles.mono}>{suggestion.key}</span>: {suggestion.note}
                        </li>
                    ))}
                    {hidden > 0 && <li>{hidden} more {hidden === 1 ? 'note' : 'notes'} on the page</li>}
                </ul>
            )}
            {result.unanswered.length > 0 && (
                <p className={styles.suggestion_text}>
                    No suggestion for {result.unanswered.map(entry => entry.key).join(', ')}.
                </p>
            )}
            <p className={styles.suggestion_cost}>
                {formatSuggestionCost(result.costUsd)} · {result.model} · {result.usage.inputTokens.toLocaleString()} in /{' '}
                {result.usage.outputTokens.toLocaleString()} out tokens
            </p>
        </div>
    );
}
