/**
 * @fileoverview The visitor-facing description of an enabled language.
 */

import type { LanguageDirection } from './LanguageDirection.js';

/**
 * The fields of an enabled language that rendering needs.
 *
 * This is what the public localization feed carries, so it leaves out the
 * administrative timestamps and never describes a disabled language.
 */
export interface IPublicLanguage {
    /** BCP 47 code, used as the URL prefix and `hreflang` value. */
    code: string;

    /** English name, used as the accessible description of the switcher entry. */
    name: string;

    /** Name in the language itself, shown as the switcher label. */
    nativeName: string;

    /** Script direction for the `dir` attribute of `<html>`. */
    direction: LanguageDirection;
}
