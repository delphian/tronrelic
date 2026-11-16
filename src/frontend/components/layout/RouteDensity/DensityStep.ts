/**
 * @fileoverview The valid interface density steps.
 *
 * Each step names a `[data-density="…"]` rule in
 * `app/semantic-tokens.scss`. TypeScript cannot read the stylesheet, and JSX
 * does not type-check a hyphenated attribute, so a misspelled step would
 * still match the bare `[data-density]` selector, render at the default
 * density, and report nothing. Typing every `data-density` value with this
 * union turns that mistake into a compile error.
 *
 * Keep the union in step with the DENSITY STEPS block in
 * `app/semantic-tokens.scss`.
 */

/**
 * A named interface density: `compact` (0.75), `cozy` (0.875), `default` (1),
 * or `roomy` (1.125). The number is the multiplier applied to layout spacing.
 * `compact` also makes unsized buttons and form controls take their `sm` step.
 */
export type DensityStep = 'compact' | 'cozy' | 'default' | 'roomy';
