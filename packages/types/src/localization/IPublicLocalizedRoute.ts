/**
 * @fileoverview A published route as the public localization feed describes it.
 */

/**
 * A route pattern and the enabled languages it is published in.
 *
 * The feed only lists languages that are enabled, so a consumer never has to
 * cross-check the language list to decide whether `/zh/...` is live.
 */
export interface IPublicLocalizedRoute {
    /** Route pattern in the syntax `matchRoutePattern` reads. */
    pattern: string;

    /** Enabled language codes the route is published in. Never empty. */
    languages: string[];
}
