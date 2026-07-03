/**
 * @fileoverview Syntax validator for operator-authored zone custom CSS.
 *
 * Mirrors `trp-themes`'s `ThemeValidator` (PostCSS-based syntax check, no
 * semantic validation of token names — an operator may reference a token
 * that doesn't exist yet). The zone editor accepts bare declarations, not
 * full rules, so the raw input is wrapped in a dummy selector before being
 * handed to PostCSS; a syntax error inside the declarations still surfaces
 * as a parse failure.
 *
 * @module backend/modules/widgets/zones/zone-css.validator
 */

import postcss from 'postcss';
import type { ISystemLogService } from '@/types';

/** Result of a zone-CSS validation pass. */
export interface IZoneCssValidationResult {
    valid: boolean;
    errors: string[];
}

/** Hard cap on stored custom CSS length — a textarea input, not a stylesheet. */
export const ZONE_CSS_MAX_LENGTH = 4000;

/**
 * PostCSS-backed syntax validator for the zone-layout `customCss` field.
 */
export class ZoneCssValidator {
    /**
     * @param logger - Scoped logger for validation-failure diagnostics.
     */
    constructor(private readonly logger: ISystemLogService) {}

    /**
     * Validate CSS declaration syntax by wrapping the input in a dummy
     * selector and parsing it with PostCSS.
     *
     * @param css - Raw declarations as typed by the operator (no selector).
     * @returns Validation result with success flag and error messages.
     */
    async validate(css: string): Promise<IZoneCssValidationResult> {
        if (css.length > ZONE_CSS_MAX_LENGTH) {
            return { valid: false, errors: [`CSS exceeds ${ZONE_CSS_MAX_LENGTH} characters.`] };
        }
        try {
            await postcss().process(`.zone-css-validate{${css}}`, { from: undefined });
            return { valid: true, errors: [] };
        } catch (error: unknown) {
            this.logger.warn({ error, css: css.substring(0, 200) }, 'Zone custom CSS validation failed');
            const errorMessage = error instanceof Error ? error.message : 'Unknown CSS syntax error';
            return { valid: false, errors: [errorMessage] };
        }
    }
}
