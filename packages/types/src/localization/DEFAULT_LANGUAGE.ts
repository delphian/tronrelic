/**
 * @fileoverview The site's default language.
 *
 * English is the language the site is written in. It is never stored as a
 * configured language and never carries a URL prefix: `/markets` is the English
 * page, and only the other languages get a prefix such as `/zh/markets`. Keeping
 * the value in one place lets the middleware, the root layout, and the backend
 * agree on which language needs no prefix and no translation lookup.
 */

/** Language code of the unprefixed, untranslated site. */
export const DEFAULT_LANGUAGE = 'en';
