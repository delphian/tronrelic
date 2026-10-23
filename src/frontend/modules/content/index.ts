/**
 * @fileoverview Public surface of the frontend content module: the admin UI
 * for core features of managed content that every content type shares.
 *
 * Today that is translations — the editor a content type's admin page mounts
 * for one item, the status row its admin list shows beside each item, and the
 * AI settings panel for translation suggestions. All talk to the core routes
 * under `/api/admin/content`. Consumers import from
 * the module root.
 *
 * @module modules/content
 */

export * from './api/client';
export { ContentTranslations } from './components/ContentTranslations';
export { ContentTranslationSettings } from './components/ContentTranslationSettings';
export { TranslationStatusBadges } from './components/TranslationStatusBadges';
