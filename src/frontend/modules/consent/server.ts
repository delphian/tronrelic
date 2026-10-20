/**
 * @fileoverview Server-only exports of the consent module.
 *
 * Kept apart from the module's `index.ts` because these call the backend
 * during server rendering, and would drag server-only code into client bundles
 * if the client barrel re-exported them.
 *
 * @module modules/consent/server
 */

export { fetchConsentConfig, FAIL_CLOSED_CONSENT_CONFIG } from './lib/fetchConsentConfig';
export { fetchConsentSeed } from './lib/fetchConsentSeed';
