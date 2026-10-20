/**
 * @fileoverview Public client-safe API of the frontend consent module.
 *
 * Server-only helpers (the settings fetch and the seed resolution) live in
 * `./server` so they never reach a client bundle.
 *
 * @module modules/consent
 */

export { ConsentProvider, DISABLED_CONSENT_SEED } from './components/ConsentProvider';
export { ConsentBanner } from './components/ConsentBanner';
export { PrivacyChoicesButton } from './components/PrivacyChoicesButton';
export { GoogleAdsTag } from './components/GoogleAdsTag';
export { SettingsTab } from './components/admin';
export { useConsent } from './hooks/useConsent';
export { sendAnonymousPageView } from './lib/sendAnonymousPageView';
export * from './api/client';
export type { IConsentSeed, IConsentContextValue } from './types';
