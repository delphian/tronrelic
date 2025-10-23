---
name: TronRelic Frontend Development
description: Load frontend documentation and apply TronRelic's design system patterns for React components, CSS styling, and accessibility
version: 2.0.0
---

# TronRelic Frontend Development

## Documentation Loader

When this skill is invoked for frontend UI/UX, CSS, HTML, or React component tasks, I will automatically load the comprehensive documentation:

**Core Documentation (always loaded):**
- [@frontend.md](../../../docs/frontend/frontend.md) - Architecture overview and quick reference
- [@frontend-architecture.md](../../../docs/frontend/frontend-architecture.md) - Complete file organization and feature module patterns
- [@frontend-component-guide.md](../../../docs/frontend/frontend-component-guide.md) - Detailed styling guide, CSS system, accessibility standards
- [@globals.css](../../../apps/frontend/styles/globals.css) - Complete design tokens reference and utility classes

**Plugin Documentation (loaded when working on plugins):**
- [@plugins.md](../../../docs/plugins/plugins.md) - Plugin system overview
- [@plugins-page-registration.md](../../../docs/plugins/plugins-page-registration.md) - Menu items and page registration
- [@plugins-frontend-context.md](../../../docs/plugins/plugins-frontend-context.md) - Context injection and shared components

## Core Principles (Quick Reference)

After loading documentation, I will apply these patterns:

1. **Feature-based organization** - Group by domain, not file type
2. **CSS Modules with design tokens** - No hardcoded values, always use `var(--color-primary)` etc.
3. **Container queries for responsiveness** - Not media queries (except in `app/layout.tsx`)
4. **Underscore naming in CSS** - `market_card` not `market-region` (enables type-safe dot notation)
5. **JSDoc with "why" before "what"** - Explain purpose and context
6. **Semantic HTML and accessibility** - ARIA labels, focus states, keyboard navigation
7. **Icons from `lucide-react`** - Never custom icon components
8. **Plugin context injection** - Use `IFrontendPluginContext` for UI components, charts, API

## When to Use This Skill vs Subagent

**Use this skill for:**
- Quick single-component edits (< 50 lines of code)
- CSS/styling fixes or adjustments
- When explicitly requested ("don't use agents")
- Conversational explanations of frontend patterns

**Delegate to `frontend-ui-specialist` subagent for:**
- Multi-component features or refactoring
- Routing, navigation, or layout changes
- Plugin UI pages (new pages or major redesigns)
- Any task matching mandatory delegation triggers (URL structure, authentication UI, context providers)
- Complex work requiring multiple file changes

**Note:** The subagent has access to all tools and comprehensive documentation. For non-trivial frontend work, delegation is preferred.

## Pre-Ship Checklist

Before completing any frontend task, verify:

- [ ] Uses CSS variables from `globals.css` (no hardcoded colors/sizes)
- [ ] Component-specific styles in colocated `.module.css` file
- [ ] Uses container queries for component-level responsiveness
- [ ] Uses built-in utility classes (`.surface`, `.btn`, `.badge`, `.stack`, `.grid`)
- [ ] Uses `lucide-react` for all icons
- [ ] JSDoc comments explain the "why" (purpose and usage context)
- [ ] Provides visual feedback for state changes (loading, error, success)
- [ ] Uses semantic HTML (`<button>`, `<nav>`, `<table>`, etc.)
- [ ] Includes ARIA labels for icon buttons and hidden elements
- [ ] Has visible focus states for all interactive elements
- [ ] Uses underscore naming in CSS Modules (e.g., `market_card`, not `market-card`)
- [ ] Tested in multiple contexts (full-page, sidebar, modal, mobile)

## Version History

- v2.0.0 (2025-10-18): Converted to documentation loader pattern; delegates complex work to frontend-ui-specialist subagent
- v1.0.0 (2025-10-18): Initial frontend development skill with inline guidance
