/**
 * @fileoverview Syntax and safety validator for operator-authored CSS that
 * the widget renderer scopes to one element.
 *
 * Zones and placements both let an operator type CSS that the frontend
 * injects verbatim into a `<style>` tag, wrapped in a rule for one element
 * (`[data-zone="…"] { … }` or `[data-placement-id="…"] { … }`). Because the
 * text reaches the page unchanged, this validator is what stops it from
 * closing the `<style>` element, escaping the wrapper rule, or loading
 * outside resources. It mirrors `trp-themes`'s `ThemeValidator` in using
 * PostCSS for the syntax check and in not checking token names, since an
 * operator may reference a token that does not exist yet.
 *
 * The two callers differ in one rule. A zone accepts declarations only,
 * because its CSS shapes the zone's own flex container. A placement also
 * accepts nested rules such as `a { … }`, because the elements an operator
 * wants to style (a menu's links, say) sit inside the widget. Native CSS
 * nesting resolves every nested rule relative to the wrapper, so the
 * scoping still holds; what the nested mode must still refuse is anything
 * at the top level other than the wrapper itself.
 *
 * Scoping is a convenience rather than a sandbox. Only administrators can
 * save this CSS, and they can already write unscoped CSS in a theme, so a
 * nested selector that reaches a sibling (`& + *`) is allowed. The security
 * guarantees are the three described on {@link ScopedCssValidator.validate}.
 *
 * @module backend/modules/widgets/css/ScopedCssValidator
 */

import postcss from 'postcss';
import type { ISystemLogService } from '@/types';

/** Result of one validation pass. */
export interface IScopedCssValidationResult {
    /** True when the CSS is safe to inject. */
    valid: boolean;
    /** Operator-facing reasons the CSS was refused; empty when valid. */
    errors: string[];
}

/** Options that differ between the zone and placement callers. */
export interface IScopedCssValidatorOptions {
    /**
     * Whether rules nested inside the wrapper are accepted. `false` keeps
     * the input to bare declarations (the zone editor); `true` also accepts
     * nested rules that style elements inside the scoped element (the
     * placement editor).
     */
    allowNestedRules: boolean;
}

/** Hard cap on stored custom CSS length — a textarea input, not a stylesheet. */
export const SCOPED_CSS_MAX_LENGTH = 4000;

/**
 * Selector the raw input is wrapped in before parsing. It stands in for the
 * real `[data-…]` selector the renderer uses, so the parse sees the same
 * structure the browser will.
 */
const WRAPPER_SELECTOR = '.scoped-css-validate';

/**
 * At-rules an operator may use. These are the conditional-group forms a
 * responsive tweak needs; everything else is refused, notably `@import`,
 * which can pull CSS from another origin.
 */
const ALLOWED_AT_RULES = new Set(['media', 'container', 'supports']);

/**
 * PostCSS-backed validator for zone and placement `customCss`. One instance
 * per caller, constructed with the options that caller needs.
 */
export class ScopedCssValidator {
    /**
     * @param logger - Scoped logger, used to record why a parse failed so an
     *   operator's report can be matched to the input that caused it.
     * @param options - Whether nested rules are accepted; see
     *   {@link IScopedCssValidatorOptions}.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly options: IScopedCssValidatorOptions
    ) {}

    /**
     * Check operator CSS before it is stored and later injected verbatim into
     * a `<style>` tag on public pages. Three defenses run in order. First the
     * literal `</style` sequence is refused, because the HTML parser closes
     * the style element there even inside a CSS comment and would then run
     * any markup that follows. Second the input is parsed for real, which
     * catches syntax errors (a plugin-less `process()` does nothing until its
     * tree is read). Third the parsed tree is walked: in declarations-only
     * mode every rule other than the wrapper is refused, and in nested mode
     * anything at the top level other than the wrapper is refused, which is
     * what a `} body { … }` breakout produces. In both modes any at-rule
     * outside {@link ALLOWED_AT_RULES} is refused.
     *
     * @param css - Raw CSS as typed by the operator, without a selector.
     * @returns Whether the CSS is safe to inject, with reasons when it is not.
     */
    async validate(css: string): Promise<IScopedCssValidationResult> {
        let errors: string[] = [];
        if (css.length > SCOPED_CSS_MAX_LENGTH) {
            errors = [`CSS exceeds ${SCOPED_CSS_MAX_LENGTH} characters.`];
        } else if (/<\/style/i.test(css)) {
            errors = ['CSS may not contain the sequence "</style".'];
        } else {
            errors = await this.findStructuralErrors(css);
        }
        return { valid: errors.length === 0, errors };
    }

    /**
     * Parse the wrapped input and report every rule or at-rule that the
     * caller's mode does not allow. Parse failures are reported as a single
     * error carrying PostCSS's message, which names the line and column.
     *
     * @param css - Raw operator CSS that has already passed the length and
     *   `</style` checks.
     * @returns The reasons the CSS was refused; empty when it is acceptable.
     */
    private async findStructuralErrors(css: string): Promise<string[]> {
        const errors: string[] = [];
        try {
            const result = await postcss().process(`${WRAPPER_SELECTOR}{${css}}`, { from: undefined });
            // Reading `.root` forces the parse; see validate().
            const root = result.root;
            if (this.options.allowNestedRules) {
                const onlyWrapper = root.nodes.length === 1
                    && root.first?.type === 'rule'
                    && root.first.selector === WRAPPER_SELECTOR;
                if (!onlyWrapper) {
                    errors.push('CSS closes the scoped rule early; keep every rule inside it.');
                }
            } else {
                root.walkRules(rule => {
                    if (rule.selector !== WRAPPER_SELECTOR) {
                        errors.push(`Selector "${rule.selector}" is not allowed; write declarations only.`);
                    }
                });
            }
            root.walkAtRules(at => {
                if (!ALLOWED_AT_RULES.has(at.name.toLowerCase())) {
                    errors.push(`At-rule "@${at.name}" is not allowed.`);
                }
            });
        } catch (error: unknown) {
            this.logger.warn({ error, css: css.substring(0, 200) }, 'Custom CSS validation failed');
            errors.push(error instanceof Error ? error.message : 'Unknown CSS syntax error');
        }
        return errors;
    }
}
