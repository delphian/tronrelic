/**
 * @fileoverview Stored shape of the consent module's settings.
 */

/**
 * The single document in `module_consent_settings`, found by its fixed `key`.
 * The wire form is `IConsentSettings`.
 */
export interface IConsentSettingsDocument {
    /** Always `'settings'`; the unique index on it keeps the collection to one document. */
    key: 'settings';
    /** Main switch for the banner, the analytics gate, and the Google Ads tag. */
    enabled: boolean;
    /** Version a visitor's saved choice must match to count. */
    policyVersion: number;
    /** Google Ads tag id, or null when no tag is configured. */
    googleAdsId: string | null;
    /** Google Ads conversion label, or null when conversions are not recorded. */
    conversionLabel: string | null;
    /** Last save. */
    updatedAt: Date;
    /** Who saved it last. */
    updatedBy: string | null;
}
