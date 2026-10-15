/**
 * @fileoverview A language the site can be translated into.
 */

import type { LanguageDirection } from './LanguageDirection.js';

/**
 * One configured language other than the default.
 *
 * An administrator adds a language before translating anything into it, and
 * the language stays invisible to visitors until `enabled` is true. Enabling a
 * language does not publish any page in it: each route still has to list the
 * language before its `/<code>/...` URL answers. That split is what lets a
 * language be switched on and rolled out one route at a time.
 */
export interface ILanguage {
    /** BCP 47 code used as the URL prefix and `hreflang` value, e.g. `zh` or `pt-BR`. */
    code: string;

    /** English name shown to administrators, e.g. `Chinese (Simplified)`. */
    name: string;

    /** Name in the language itself, shown to visitors in the language switcher, e.g. `简体中文`. */
    nativeName: string;

    /** Script direction, written to the `dir` attribute of `<html>`. */
    direction: LanguageDirection;

    /**
     * Whether visitors can reach this language at all. While false, a
     * `/<code>/...` URL is treated as an ordinary English path, so it never
     * takes over a page that already lives at that address.
     */
    enabled: boolean;

    /** ISO timestamp of when the language was added. */
    createdAt: string;

    /** ISO timestamp of the last change to the language's settings. */
    updatedAt: string;
}
