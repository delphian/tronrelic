/**
 * @fileoverview Accepted shape of a language code.
 *
 * Language codes become the first segment of a URL (`/zh/...`) and the value of
 * `hreflang` attributes, so they must be short, URL-safe, and in the BCP 47
 * form search engines expect. The pattern accepts a two- or three-letter
 * lowercase language subtag, optionally followed by region or script subtags,
 * as in `zh`, `pt-BR`, or `zh-Hant`. The backend rejects any other value when a
 * language is created, which is what keeps junk out of URLs and markup.
 */

/** Regular expression a configured language code must match. */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
