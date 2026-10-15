/**
 * @fileoverview Stored shape of a configured language.
 */

import type { LanguageDirection } from '@/types';

/**
 * One document in `module_localization_languages`, unique on `code`. The wire
 * form is `ILanguage`, which carries the same fields with ISO date strings.
 */
export interface ILanguageDocument {
    /** BCP 47 code, the URL prefix. */
    code: string;
    /** English name for administrators. */
    name: string;
    /** Name in the language itself, for visitors. */
    nativeName: string;
    /** Script direction. */
    direction: LanguageDirection;
    /** Whether visitors can reach the language. */
    enabled: boolean;
    /** When the language was added. */
    createdAt: Date;
    /** When its settings last changed. */
    updatedAt: Date;
}
