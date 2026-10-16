/**
 * @fileoverview Barrel for the localization domain: the languages, published
 * routes, translations, and the pure helpers the frontend middleware and the
 * backend share so they reach the same answer about which URL is in which
 * language.
 */

export type { LanguageDirection } from './LanguageDirection.js';
export type { ILanguage } from './ILanguage.js';
export type { ILocalizedRoute } from './ILocalizedRoute.js';
export type { ITranslationKey } from './ITranslationKey.js';
export type { ITranslation } from './ITranslation.js';
export type { IPublicLanguage } from './IPublicLanguage.js';
export type { IPublicLocalizedRoute } from './IPublicLocalizedRoute.js';
export type { ILocalizationPublicConfig } from './ILocalizationPublicConfig.js';
export type { ITranslationCatalog } from './ITranslationCatalog.js';
export type { ITranslationObservation } from './ITranslationObservation.js';
export type { TranslationParams } from './TranslationParams.js';
export type { ITranslator } from './ITranslator.js';
export type { ILocalizationService } from './ILocalizationService.js';
export type { TranslationStatus } from './TranslationStatus.js';
export type { ILanguageSummary } from './ILanguageSummary.js';
export type { ILocalizedRouteSummary } from './ILocalizedRouteSummary.js';
export type { ITranslationRow } from './ITranslationRow.js';
export type { ITranslationPage } from './ITranslationPage.js';
export type { ITranslationNamespaceSummary } from './ITranslationNamespaceSummary.js';
export type { IResolvedLocalizedPath } from './IResolvedLocalizedPath.js';
export type { ILocalizationSettings } from './ILocalizationSettings.js';
export type { ITranslationSuggestion } from './ITranslationSuggestion.js';
export type { ITranslationSuggestionRequest } from './ITranslationSuggestionRequest.js';
export type { ITranslationSuggestionResult } from './ITranslationSuggestionResult.js';

export { DEFAULT_LANGUAGE } from './DEFAULT_LANGUAGE.js';
export { MAX_TRANSLATION_SUGGESTION_KEYS } from './MAX_TRANSLATION_SUGGESTION_KEYS.js';
export { LANGUAGE_CODE_PATTERN } from './LANGUAGE_CODE_PATTERN.js';
export { matchRoutePattern } from './matchRoutePattern.js';
export { isValidRoutePattern } from './isValidRoutePattern.js';
export { localizePath } from './localizePath.js';
export { localizeHref } from './localizeHref.js';
export { findPublishedLanguages } from './findPublishedLanguages.js';
export { resolveLocalizedPath } from './resolveLocalizedPath.js';
export { interpolateTranslation } from './interpolateTranslation.js';
