/**
 * @fileoverview Reading direction of a language's script.
 *
 * Arabic, Hebrew, Persian, and Urdu read right to left. The root layout writes
 * this value to the `dir` attribute of `<html>` so the browser mirrors the page
 * for those languages instead of laying right-to-left text into a left-to-right
 * page.
 */

/**
 * `ltr` for left-to-right scripts such as Latin, Cyrillic, and Chinese, and
 * `rtl` for right-to-left scripts such as Arabic and Hebrew.
 */
export type LanguageDirection = 'ltr' | 'rtl';
