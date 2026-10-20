/**
 * @fileoverview The consent module's settings as the admin page reads them.
 */

import type { IConsentPublicConfig } from './IConsentPublicConfig.js';

/**
 * The public configuration plus who last changed it, as served to the
 * Settings tab of `/system/consent`.
 */
export interface IConsentSettings extends IConsentPublicConfig {
    /** Last save, or null before the settings were first saved. */
    updatedAt: string | null;

    /** Who saved them last, or null before the first save. */
    updatedBy: string | null;
}
