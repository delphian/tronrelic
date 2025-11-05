# Design Tokens and Site Theming

This document provides comprehensive guidance on TronRelic's design token system and standardized theming approach. Design tokens are named design decisions (colors, spacing, typography) implemented as CSS variables that ensure visual consistency across all components, features, and plugins.

## Who This Document Is For

Frontend developers implementing new components, plugin authors creating custom UI, and designers maintaining visual consistency across the TronRelic interface.

## Why This Matters

**Risk of inconsistent theming:**
- Hardcoded color values create visual fragmentation across features
- Ad-hoc spacing decisions make interfaces feel disjointed
- Duplicated style definitions bloat CSS and complicate maintenance
- Refactoring themes becomes impossible when values are scattered

**Benefits of centralized design tokens:**
- Single source of truth for all design decisions
- Theme changes propagate automatically across entire application
- Predictable visual hierarchy with standardized sizing scales
- Easy theme switching (light/dark mode, accessibility variants)
- Reduced CSS bundle size through shared utility classes
- Semantic naming makes intent clear (--color-primary vs #4b8cff)

## The Token Hierarchy (Industry Standard)

TronRelic implements a **three-layer design token system** following the architecture used by Material Design, Adobe Spectrum, Shopify Polaris, GitHub Primer, and the W3C Design Tokens Community Group specification. This pattern separates concerns and enables flexible theming without duplicating values or creating maintenance nightmares.

### Layer 1: Foundation Tokens (Primitives)

**File:** `primitives.css`

Foundation tokens define primitive design values—the raw materials of the design system. These are context-free, reusable values with no semantic meaning attached.

**Industry terminology:**
- "Primitives" (Material Design, Shopify Polaris)
- "Foundation tokens" (Adobe Spectrum)
- "Base tokens" (W3C Design Tokens Community Group)

**Purpose:**
- Define the lowest-level design decisions (color palette, spacing scale, typography scale)
- Provide raw values that semantic tokens reference
- Establish the visual foundation independent of usage context

**Examples:**
```css
/* Colors - raw palette values */
--color-blue-500: #4b8cff;
--color-gray-100: #f5f5f5;
--color-red-600: #dc2626;

/* Spacing - base scale */
--spacing-1: 0.25rem;  /* 4px */
--spacing-7: 1.75rem;  /* 28px */

/* Typography - primitive scales */
--font-size-base: 1rem;
--font-weight-semibold: 600;

/* Radius - curvature scale */
--radius-md: 0.375rem;
--radius-full: 9999px;
```

**Usage:**
Referenced by semantic tokens (Layer 2) and occasionally by CSS Modules for one-off needs. Foundation tokens should rarely appear directly in component code.

### Layer 2: Semantic Tokens (Alias Tokens)

**File:** `semantic-tokens.css`

Semantic tokens compose foundation tokens into meaningful, context-aware variables. They answer "what is this for?" rather than "what does this look like?"

**Industry terminology:**
- "Semantic tokens" (Adobe Spectrum, W3C)
- "Alias tokens" (Material Design)
- "Component tokens" (GitHub Primer)
- "Decision tokens" (Shopify Polaris)

**Purpose:**
- Assign semantic meaning to primitive values (e.g., `--button-bg-primary` instead of `--color-blue-500`)
- Enable theme switching by remapping semantic tokens to different primitives
- Provide component-specific theming decisions built from Layer 1 primitives

**Examples:**
```css
/* Buttons - semantic composition */
--button-bg-primary: var(--color-blue-500);
--button-padding-md: var(--spacing-3) var(--spacing-7);
--button-border-radius: var(--radius-md);

/* Cards - semantic surface tokens */
--card-bg: var(--color-white);
--card-border-radius: var(--radius-lg);
--card-shadow: var(--shadow-md);

/* Modals - semantic overlay tokens */
--modal-backdrop-blur: 8px;
--modal-content-bg: var(--color-white);
```

**Usage:**
Provide consistent theming for specific UI components. When you need dark mode, you remap semantic tokens (e.g., `--card-bg: var(--color-gray-900)`) without touching foundation tokens.

### Layer 3: Utility Classes (Application Layer)

**File:** `globals.css`

Utility classes apply design tokens to create reusable UI patterns. This is where tokens meet markup—the presentation layer that developers interact with most often.

**Industry terminology:**
- "Utility classes" (Tailwind CSS, Primer)
- "Component classes" (Bootstrap, Material Design)
- "Pattern library" (Carbon Design System)

**Purpose:**
- Provide ready-to-use classes for common patterns (buttons, cards, badges, layouts)
- Apply semantic tokens to HTML elements consistently
- Reduce CSS duplication by standardizing implementation

**Examples:**
```css
/* Button utilities - apply semantic tokens */
.btn {
    padding: var(--button-padding-md);
    background: var(--button-bg-primary);
    border-radius: var(--button-border-radius);
}

/* Card utilities - surface patterns */
.card {
    background: var(--card-bg);
    border-radius: var(--card-border-radius);
    box-shadow: var(--card-shadow);
}

/* Layout utilities - spacing patterns */
.stack {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-4);
}
```

**Usage:**
Applied directly in component markup or mixed with CSS Module classes for component-specific customization.

### Why This Architecture Matters

This three-layer approach is **not a TronRelic invention**—it's an industry-proven pattern that solves real scaling problems:

**Single source of truth:**
When you need to change button padding across the entire application, you modify one semantic token (`--button-padding-md`) instead of hunting through dozens of CSS Module files.

**Theme switching without rewrites:**
Dark mode, accessibility variants, and brand customization become configuration changes (remap semantic tokens) instead of code changes (rewrite component styles).

**Predictable cascading updates:**
When you adjust the spacing scale in foundation tokens, all dependent semantic tokens inherit the change automatically. This prevents the fragmentation that occurs when components hardcode values or duplicate CSS variables locally.

**Proven at scale:**
Google (Material Design), Adobe (Spectrum), Shopify (Polaris), and GitHub (Primer) all use this pattern to maintain visual consistency across massive design systems with hundreds of components.

### Token Naming Conventions

TronRelic follows semantic naming patterns used across industry design systems:

**Foundation tokens (primitives):**
```
--{category}-{variant}-{scale}
--color-blue-500
--spacing-7
--font-size-lg
```

**Semantic tokens (aliases):**
```
--{component}-{property}-{variant}
--button-bg-primary
--card-border-radius
--modal-backdrop-blur
```

**Component tokens can also use:**
```
--{context}-{element}-{property}
--sidebar-header-padding
--modal-content-bg
```

This naming strategy makes intent clear at a glance and prevents naming collisions between layers.

## Design Token Reference

TronRelic's design tokens are implemented as CSS custom properties (CSS variables) in `globals.css`. All tokens use semantic naming that describes their purpose rather than their appearance.

[Placeholder: Complete reference of all design tokens from globals.css]

### Color System

[Placeholder: Color palette with usage guidelines]

### Spacing and Layout

[Placeholder: Spacing scale, radius scale, shadow scale]

### Typography

[Placeholder: Font families, sizes, weights, line heights]

### Breakpoints

[Placeholder: Responsive breakpoint system]

## Standardized Utility Classes

[Placeholder: Complete list of utility classes with examples]

### Layout Utilities

[Placeholder: Stack, grid, flex patterns]

### Surface Utilities

[Placeholder: Card, panel, surface modifiers]

### Interactive Utilities

[Placeholder: Button, badge, chip patterns]

### State Utilities

[Placeholder: Loading, error, success states]

## Usage Guidelines

[Placeholder: Best practices and anti-patterns]

### Component-Specific Styles

[Placeholder: When to use CSS Modules vs utilities]

### Container Queries

[Placeholder: Responsive design patterns]

### Theme Customization

[Placeholder: How to extend or modify the theme]

## Migration Guide

[Placeholder: Migrating legacy styles to use CSS variables]

## Industry Alignment and Resources

TronRelic's design token system follows widely-adopted patterns from major design systems. Understanding how other teams solve similar problems helps you recognize best practices and avoid reinventing solutions.

### Design Systems Using This Pattern

**Material Design (Google):**
- Uses primitives (color palette, spacing scale) and semantic tokens (primary color, surface color)
- Theme switching through token remapping
- Comprehensive documentation: https://m3.material.io/foundations/design-tokens/overview

**Adobe Spectrum:**
- Foundation tokens (primitives) → Semantic tokens → Component-specific tokens
- Cross-platform consistency (web, iOS, Android)
- Token documentation: https://spectrum.adobe.com/page/design-tokens/

**Shopify Polaris:**
- Base tokens (primitives) → Decision tokens (semantic) → Component styles
- Tokio tooling for token management
- Design tokens guide: https://polaris.shopify.com/tokens/colors

**GitHub Primer:**
- Functional variables (primitives) → Component variables → Utilities
- CSS variable-based theming
- Token reference: https://primer.style/foundations/primitives

**Carbon Design System (IBM):**
- Foundation layer → Theme layer → Component layer
- Extensive token documentation and tooling
- Token overview: https://carbondesignsystem.com/guidelines/color/overview

### W3C Design Tokens Community Group

The W3C Design Tokens Community Group is working on a formal specification for design token formats, interchange, and tooling. TronRelic's approach aligns with the draft specification's principles:

- **Token types:** Primitive values (color, dimension, duration) and composite values (border, shadow, typography)
- **Token hierarchy:** Foundation tokens reference raw values; semantic tokens reference foundation tokens
- **Naming conventions:** Semantic, purpose-driven names instead of appearance-based names
- **Format agnostic:** Tokens can be authored in JSON, YAML, or CSS and converted to platform-specific formats

Learn more: https://www.w3.org/community/design-tokens/

### Tooling and Automation

**Style Dictionary (Amazon):**
- Transform design tokens from source format (JSON) to platform-specific outputs (CSS, SCSS, iOS, Android)
- Used by Amazon, Salesforce, and many others
- TronRelic currently uses hand-authored CSS but could adopt Style Dictionary for automation
- Repository: https://github.com/amzn/style-dictionary

**Figma Tokens:**
- Sync design tokens between Figma designs and codebase
- Bridge design and development workflows
- Plugin: https://www.figma.com/community/plugin/843461159747178978

**Theo (Salesforce):**
- Design token transformation and validation
- Multi-platform token generation
- Repository: https://github.com/salesforce-ux/theo

### Adopting Best Practices

When working with TronRelic's design tokens, remember:

1. **This is not custom architecture** - You're working with patterns proven at Google, Adobe, Shopify, and GitHub scale
2. **Semantic naming prevents chaos** - `--button-bg-primary` beats `--blue-500` when refactoring themes
3. **Token layers enable flexibility** - Foundation tokens stay stable; semantic tokens adapt to context
4. **Industry tooling exists** - Consider Style Dictionary if token management becomes complex
5. **Documentation matters** - Major design systems invest heavily in token documentation (as should we)

## Further Reading

**TronRelic documentation:**
- [ui-component-styling.md](./ui-component-styling.md) - Component styling patterns and CSS Module usage
- [frontend-architecture.md](./frontend-architecture.md) - Frontend file organization and structure

**TronRelic source files:**
- [apps/frontend/app/primitives.css](../../apps/frontend/app/primitives.css) - Foundation tokens (primitives)
- [apps/frontend/app/semantic-tokens.css](../../apps/frontend/app/semantic-tokens.css) - Semantic tokens (aliases)
- [apps/frontend/app/globals.css](../../apps/frontend/app/globals.css) - Utility classes and global styles

**External resources:**
- Material Design Tokens: https://m3.material.io/foundations/design-tokens/overview
- Adobe Spectrum Tokens: https://spectrum.adobe.com/page/design-tokens/
- Shopify Polaris Tokens: https://polaris.shopify.com/tokens/colors
- GitHub Primer Tokens: https://primer.style/foundations/primitives
- W3C Design Tokens Community Group: https://www.w3.org/community/design-tokens/
- Style Dictionary (Amazon): https://github.com/amzn/style-dictionary
