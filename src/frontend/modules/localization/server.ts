/**
 * @fileoverview Server-only exports of the localization module.
 *
 * Kept apart from the module's `index.ts` because these read request headers
 * and call the backend during server rendering, and would drag server-only
 * code into client bundles if the client barrel re-exported them.
 *
 * @module modules/localization/server
 */

export { fetchLocalizationConfig, fetchTranslationCatalog, ENGLISH_ONLY_CONFIG } from './lib/fetchLocalization';
export { resolveRequestLanguage, resolveMetadataLanguage } from './lib/resolveRequestLanguage';
export type { IRequestLanguage } from './lib/resolveRequestLanguage';
export { fetchLocalizationSeed } from './lib/fetchLocalizationSeed';
export { getServerTranslator } from './lib/getServerTranslator';
