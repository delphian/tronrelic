import postcss from 'postcss';
import type { ISystemLogService } from '@tronrelic/types';

/**
 * Result of CSS validation operation.
 */
export interface IValidationResult {
    /**
     * Whether the CSS is syntactically valid.
     */
    valid: boolean;

    /**
     * Array of error messages if validation failed.
     * Empty array if valid.
     */
    errors: string[];
}

/**
 * CSS validator using PostCSS parser.
 *
 * Provides basic syntax validation for theme CSS content. Does not perform
 * semantic validation (checking if CSS variables exist in the design system).
 * This ensures themes can override any CSS without being constrained by
 * backend knowledge of frontend token structure.
 */
export class ThemeValidator {
    /**
     * Create a theme validator.
     *
     * @param logger - System log service for validation errors
     */
    constructor(private readonly logger: ISystemLogService) {}

    /**
     * Validate CSS syntax using PostCSS parser.
     *
     * Parses the CSS string and catches any syntax errors. Returns structured
     * validation result with error messages extracted from parser exceptions.
     *
     * @param css - Raw CSS content to validate
     * @returns Validation result with success flag and error messages
     *
     * @example
     * const result = await validator.validate('.theme { color: blue; }');
     * if (!result.valid) {
     *     console.error('CSS errors:', result.errors);
     * }
     */
    async validate(css: string): Promise<IValidationResult> {
        try {
            // Parse CSS with PostCSS - will throw on syntax errors
            await postcss().process(css, { from: undefined });

            return {
                valid: true,
                errors: []
            };
        } catch (error: any) {
            this.logger.warn(
                { error, css: css.substring(0, 200) },
                'CSS validation failed'
            );

            // Extract error message from PostCSS exception
            const errorMessage = error.message || 'Unknown CSS syntax error';

            return {
                valid: false,
                errors: [errorMessage]
            };
        }
    }
}
