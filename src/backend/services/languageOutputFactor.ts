/**
 * @fileoverview How many output tokens to budget per English character when a
 * model translates into a given language.
 *
 * Every translation feature sizes its output budget from the English it sends,
 * and a budget that fits one language's script falls short for another. The
 * factor lives here, apart from any one feature's prompt, so interface text
 * and content are budgeted by the same rule and a correction for one language
 * reaches both.
 *
 * @module backend/services/languageOutputFactor
 */

/**
 * Output tokens budgeted per English character when the target language has
 * no entry in {@link LANGUAGE_OUTPUT_FACTORS}. English runs about four
 * characters per token, so one token per character already allows four times
 * the English token count, which covers Latin-script languages and the
 * Chinese, Japanese, and Korean scripts.
 */
export const DEFAULT_LANGUAGE_OUTPUT_FACTOR = 1;

/**
 * Output tokens budgeted per English character for languages whose text
 * tokenizes into noticeably more pieces than the default allows for. Keyed by
 * the primary language subtag. The factors are conservative round numbers
 * rather than measurements: a translation that fails for a language listed
 * here is a reason to raise its entry, and one that fails for an unlisted
 * language is a reason to add one.
 *
 * The 1.5 group is scripts current tokenizers split close to per character
 * or per byte (Indic, Thai, Burmese, Khmer, Lao, Ethiopic, Georgian, and
 * Armenian) plus Vietnamese, whose heavy diacritics have the same effect on a
 * Latin script. The 1.25 group is Arabic-script, Cyrillic, and Greek text,
 * which tokenizes less efficiently than Latin text but not by as much.
 */
const LANGUAGE_OUTPUT_FACTORS: Readonly<Record<string, number>> = {
    vi: 1.5,
    th: 1.5,
    hi: 1.5,
    bn: 1.5,
    ta: 1.5,
    te: 1.5,
    mr: 1.5,
    gu: 1.5,
    kn: 1.5,
    ml: 1.5,
    pa: 1.5,
    ne: 1.5,
    si: 1.5,
    my: 1.5,
    km: 1.5,
    lo: 1.5,
    am: 1.5,
    ka: 1.5,
    hy: 1.5,
    ar: 1.25,
    fa: 1.25,
    ur: 1.25,
    he: 1.25,
    ru: 1.25,
    uk: 1.25,
    bg: 1.25,
    sr: 1.25,
    mk: 1.25,
    kk: 1.25,
    mn: 1.25,
    el: 1.25
};

/**
 * The output tokens to budget per English character for a target language.
 *
 * Only the primary subtag decides the factor, so a regional code such as
 * `pt-BR` takes the same factor as `pt`: the script is what drives token
 * count, and the script does not change with the region.
 *
 * @param code - BCP 47 code of the target language.
 * @returns The factor an estimate multiplies the English character count by.
 */
export function languageOutputFactor(code: string): number {
    const primary = code.toLowerCase().split('-')[0];
    return LANGUAGE_OUTPUT_FACTORS[primary] ?? DEFAULT_LANGUAGE_OUTPUT_FACTOR;
}
