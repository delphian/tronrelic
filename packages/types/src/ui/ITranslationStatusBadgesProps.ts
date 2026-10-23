/**
 * @file ITranslationStatusBadgesProps.ts
 *
 * Props of the core translation status row, `TranslationStatusBadges`.
 * Declared here so the component and the plugin-facing
 * `context.system.TranslationStatusBadges` share one shape.
 */

import type { IContentTranslationStatus } from '../content/IContentTranslationStatus.js';

/**
 * One item's translation statuses, as the admin list fetched them.
 */
export interface ITranslationStatusBadgesProps {
    /**
     * The item's translations, from the `translation-status` admin route.
     * Undefined while the statuses are still loading or could not be loaded,
     * so the row does not claim "no translations" before it knows.
     */
    statuses: IContentTranslationStatus[] | undefined;
}
