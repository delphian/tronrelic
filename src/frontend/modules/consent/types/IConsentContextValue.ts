/**
 * @fileoverview What `useConsent` returns.
 *
 * @module modules/consent/types/IConsentContextValue
 */

import type { IConsentPublicConfig, IConsentState } from '@/types';

/**
 * The consent settings, this visitor's current state, and the actions the
 * banner and the "Privacy choices" button need.
 */
export interface IConsentContextValue {
    /** The consent settings in force. */
    config: IConsentPublicConfig;

    /** What this visitor allows, updated as soon as they save a choice. */
    state: IConsentState;

    /** Whether the visitor opened the detailed choices from "Privacy choices". */
    settingsOpen: boolean;

    /** Open the detailed choices, so a visitor can change an earlier answer. */
    openSettings(): void;

    /** Close the detailed choices without saving. */
    closeSettings(): void;

    /**
     * Save the visitor's choice. Withdrawing something previously allowed
     * reloads the page, so cookies already set are removed and the Google Ads
     * tag is no longer running; granting takes effect without a reload.
     *
     * @param choice - Whether the visitor allows analytics and advertising.
     */
    save(choice: { analytics: boolean; ads: boolean }): void;
}
