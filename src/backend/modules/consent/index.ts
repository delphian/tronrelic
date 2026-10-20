/**
 * @fileoverview Public API of the consent module.
 */

export { ConsentModule, CONSENT_SERVICE_NAME } from './ConsentModule.js';
export type { IConsentModuleDependencies } from './ConsentModule.js';
export { ConsentService } from './services/consent.service.js';
export type { IConsentSettingsPatch } from './services/consent.service.js';
export { AnonymousPageviewService } from './services/anonymous-pageview.service.js';
