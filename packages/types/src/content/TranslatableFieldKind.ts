/**
 * @file TranslatableFieldKind.ts
 *
 * What kind of value a translatable field holds. Core uses the kind to decide
 * three things without knowing anything else about the content type: which
 * editor control the translation editor shows, whether the AI Suggest request
 * translates the value, and whether the value counts toward the stale check.
 */

/**
 * `text` — one line of prose, such as a title. Translated.
 * `multiline` — plain prose over several lines, such as a description. Translated.
 * `markdown` — a Markdown body whose structure must survive translation. Translated.
 * `string-list` — a list of short phrases, such as keywords. Each entry is translated.
 * `url` — an address, such as a social image, that a language may override.
 *   Never sent to the model and never part of the stale check, because a URL
 *   is not text a translator rewrites.
 */
export type TranslatableFieldKind = 'text' | 'multiline' | 'markdown' | 'string-list' | 'url';
