/**
 * @fileoverview Public exports of the localization module.
 */

export { LocalizationModule, LOCALIZATION_SERVICE_NAME } from './LocalizationModule.js';
export type { ILocalizationModuleDependencies } from './LocalizationModule.js';
export { LocalizationService } from './services/localization.service.js';
export { LocalizationAdminService } from './services/localization-admin.service.js';
export { TranslationObservationService } from './services/translation-observation.service.js';
export { LanguageSwitchService } from './services/language-switch.service.js';
export { LOCALIZATION_COLLECTION_PREFIX } from './database/index.js';
