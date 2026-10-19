/**
 * @fileoverview Public client-safe API of the frontend localization module.
 *
 * Server-only helpers (the snapshot and catalog fetches, request-language
 * resolution) live in `./server` so they never reach a client bundle.
 *
 * @module modules/localization
 */

export { LocalizationProvider, ENGLISH_SEED } from './components/LocalizationProvider';
export { LanguageSwitcher } from './components/LanguageSwitcher';
export { LanguagesTab, RoutesTab, TranslationsTab, SettingsTab, SwitchesTab } from './components/admin';
export { useTranslation } from './hooks/useTranslation';
export { CORE_TRANSLATION_NAMESPACE } from './lib/CORE_TRANSLATION_NAMESPACE';
export { useLocalization } from './hooks/useLocalization';
export { useLocalizedHref } from './hooks/useLocalizedHref';
export { createTranslator } from './lib/createTranslator';
export { buildLanguageAlternates } from './lib/buildLanguageAlternates';
export type { ILanguageAlternate } from './lib/buildLanguageAlternates';
export { LANGUAGE_REQUEST_HEADER } from './lib/LANGUAGE_REQUEST_HEADER';
export type { ILocalizationSeed } from './types';
