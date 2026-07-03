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
     * Validate operator-authored zone CSS before it is injected verbatim into
     * a `<style>` tag on public pages. Three defenses, in order: reject the
     * literal `</style` sequence (the HTML parser closes the style element
     * there and would execute any following markup), force a real PostCSS
     * parse to catch syntax errors (a plugin-less `process()` is a lazy no-op
     * until its tree is read), and walk the parsed tree to reject any rule
     * that breaks out of the wrapper selector plus any at-rule other than the
     * conditional-group forms a responsive tweak legitimately needs.
     *
     * @param css - Raw declarations as typed by the operator (no selector).
     * @returns Validation result with success flag and error messages.
     */
    async validate(css: string): Promise<IZoneCssValidationResult> {
        if (css.length > ZONE_CSS_MAX_LENGTH) {
            return { valid: false, errors: [`CSS exceeds ${ZONE_CSS_MAX_LENGTH} characters.`] };
        }
        // Injected verbatim into a <style> tag via dangerouslySetInnerHTML.
        // The HTML parser closes a <style> block at the first literal `</style`
        // — even inside a CSS comment or string — so a
        // `/* </style><script>…</script> */` payload would break out and
        // execute. Reject the sequence outright.
        if (/<\/style/i.test(css)) {
            return { valid: false, errors: ['CSS may not contain the sequence "</style".'] };
        }
        try {
            const result = await postcss().process(`.zone-css-validate{${css}}`, { from: undefined });
            // Reading `.root` forces the parse: process() with no plugins
            // returns a lazily-evaluated NoWorkResult that never parses (and
            // never surfaces a syntax error) unless the tree is walked.
            const errors: string[] = [];
            result.root.walkRules(rule => {
                if (rule.selector !== '.zone-css-validate') {
                    errors.push(`Selector "${rule.selector}" is not allowed; write declarations only.`);
                }
            });
            // Permit only the conditional-group at-rules a responsive zone
            // tweak needs; reject the rest (e.g. @import can pull remote CSS).
            const allowedAtRules = new Set(['media', 'container', 'supports']);
            result.root.walkAtRules(at => {
                if (!allowedAtRules.has(at.name.toLowerCase())) {
                    errors.push(`At-rule "@${at.name}" is not allowed.`);
                }
            });
            if (errors.length > 0) {
                return { valid: false, errors };
            }
            return { valid: true, errors: [] };
        } catch (error: unknown) {
            this.logger.warn({ error, css: css.substring(0, 200) }, 'Zone custom CSS validation failed');
            const errorMessage = error instanceof Error ? error.message : 'Unknown CSS syntax error';
            return { valid: false, errors: [errorMessage] };
        }
    }
}
