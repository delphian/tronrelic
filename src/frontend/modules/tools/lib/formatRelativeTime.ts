/**
 * @fileoverview Words the distance between a moment and now ("3 days ago",
 * "in 2 hours") in the page's language.
 */

import type { ITranslator } from '@/types';

/** The units a relative time is stated in, from smallest to largest. */
type RelativeUnit = 'second' | 'minute' | 'hour' | 'day' | 'year';

/**
 * English text for one unit, in its singular and plural forms. The translation
 * keys are built from the unit name, so each form has a stable key of its own;
 * the localization module has no plural support, which is why both forms are
 * listed rather than derived.
 */
const UNIT_COPY: Record<RelativeUnit, { one: string; many: string }> = {
    second: { one: '{count} second', many: '{count} seconds' },
    minute: { one: '{count} minute', many: '{count} minutes' },
    hour: { one: '{count} hour', many: '{count} hours' },
    day: { one: '{count} day', many: '{count} days' },
    year: { one: '{count} year', many: '{count} years' }
};

/**
 * Describe how far a timestamp lies from now, in the visitor's language.
 *
 * The timestamp converter's API also returns a relative time, but the backend
 * words it in English, so a translated page would show English in the middle
 * of translated text. Formatting it here lets every part of the phrase go
 * through `t`. The unit thresholds match the backend's, so an English page
 * reads the same as before.
 *
 * @param timestampMs - The moment to describe, in milliseconds since the epoch.
 * @param nowMs - The current time in milliseconds. Passed in rather than read
 *   here so the result is predictable for a given pair of inputs.
 * @param t - The page's translator, so the phrase renders in the page's language.
 * @returns A phrase such as "just now", "5 minutes ago", or "in 2 days".
 */
export function formatRelativeTime(timestampMs: number, nowMs: number, t: ITranslator['t']): string {
    const diffMs = nowMs - timestampMs;
    const seconds = Math.floor(Math.abs(diffMs) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const years = Math.floor(days / 365);

    let unit: RelativeUnit;
    let count: number;
    if (seconds < 60) {
        unit = 'second';
        count = seconds;
    } else if (minutes < 60) {
        unit = 'minute';
        count = minutes;
    } else if (hours < 24) {
        unit = 'hour';
        count = hours;
    } else if (days < 365) {
        unit = 'day';
        count = days;
    } else {
        unit = 'year';
        count = years;
    }

    const form = count === 1 ? 'one' : 'many';
    const span = t(`tools.timestampConverter.relative.${unit}.${form}`, UNIT_COPY[unit][form], { count });

    let phrase: string;
    if (seconds < 5) {
        phrase = t('tools.timestampConverter.relative.justNow', 'just now');
    } else if (diffMs > 0) {
        phrase = t('tools.timestampConverter.relative.past', '{span} ago', { span });
    } else {
        phrase = t('tools.timestampConverter.relative.future', 'in {span}', { span });
    }

    return phrase;
}
