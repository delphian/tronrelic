/**
 * @fileoverview Public surface of the frontend content module: the admin UI
 * for core features of managed content that every content type shares.
 *
 * Today that is translations — the editor a content type's admin page mounts
 * for one item, and the AI settings panel for translation suggestions. Both
 * talk to the core routes under `/api/admin/content`. Consumers import from
 * the module root.
 *
 * @module modules/content
 */

export * from './api/client';
export { ContentTranslations } from './components/ContentTranslations';
export type { ContentTranslationsProps } from './components/ContentTranslations';
export { ContentTranslationSettings } from './components/ContentTranslationSettings';
