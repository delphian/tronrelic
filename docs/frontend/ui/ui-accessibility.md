# Accessibility and Plugin Styling

TronRelic components use semantic HTML, visible focus states, and ARIA labels to ensure accessibility. This document also covers the styling rules specific to plugin frontends, which access design system components through dependency injection rather than direct imports.

## Why This Matters

Without semantic HTML, screen readers cannot navigate the interface. Without visible focus states, keyboard users cannot tell which element is active. Without ARIA labels, icon-only buttons are invisible to assistive technology. Plugins that ignore the design system clash visually and break accessibility guarantees.

## Semantic HTML

Use semantic HTML elements instead of generic divs for interactive content:

```tsx
// Good - semantic structure
<button onClick={handleClick}>Submit</button>
<nav>
    <ul>
        <li><a href="/markets">Markets</a></li>
    </ul>
</nav>

// Bad - divs with click handlers
<div onClick={handleClick}>Submit</div>
```

Buttons, links, lists, and navigation landmarks communicate purpose to assistive technology. Generic divs require extra ARIA attributes to achieve the same result.

## Focus Management

All interactive elements must have visible focus states. The design system provides these automatically for `<button>`, `<input>`, and `<a>` elements.

For custom interactive elements, ensure `focus-visible` is styled:

```tsx
<div
    role="button"
    tabIndex={0}
    className="custom-interactive"
    onKeyDown={handleKeyDown}
>
    Custom Element
</div>
```

## ARIA Labels

Add ARIA labels for icons and interactive elements without visible text:

```tsx
import { Search, X } from 'lucide-react';

<button aria-label="Search markets">
    <Search size={18} />
</button>

<button onClick={onClose} aria-label="Close panel">
    <X size={20} />
</button>
```

Every icon-only button needs an `aria-label` describing its action, not its appearance.

## Plugin Styling Rules

Plugin frontends access design system components through `context.ui` and `context.layout` — they cannot import from `apps/frontend` directly. These rules ensure plugins integrate visually.

### Use Layout Components for Page Structure

Plugin pages must use `<layout.Page>` for page-level structure:

```tsx
export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui } = context;

    return (
        <layout.Page>
            <layout.PageHeader title="My Plugin" subtitle="Description" />
            <ui.Card>
                <layout.Stack gap="md">
                    <p>Content here</p>
                </layout.Stack>
            </ui.Card>
        </layout.Page>
    );
}
```

For container queries on the page wrapper, add a module class alongside the Page component:

```tsx
<div className={styles.container}>
    <layout.Page>
        <ui.Card>...</ui.Card>
    </layout.Page>
</div>
```

```scss
.container {
    container-type: inline-size;
    container-name: my-plugin-page;
}
```

### Always Use Container Queries

Plugins render in various contexts (full pages, cards, modals, slideouts). Never use viewport media queries for plugin styling — always use container queries. See [ui-responsive-design.md](./ui-responsive-design.md) for the full pattern.

### Use Context Components Over Raw Divs

Access design system components through `context.ui` and `context.layout`. Never use raw divs with inline styles or surface classes when a component exists:

```tsx
// Good - context components with SCSS Module customization
<layout.Grid columns="responsive" gap="md">
    <ui.Card className={styles.custom_card}>
        <layout.Stack gap="sm">
            <h3>Title</h3>
            <p className="text-muted">Content</p>
        </layout.Stack>
    </ui.Card>
</layout.Grid>
```

```scss
.custom_card {
    border: var(--border-width-thin) solid var(--color-primary);
    container-type: inline-size;
    container-name: custom-card;
}
```

### Use SCSS Modules for Plugin Styles

Add custom styling via colocated `.module.scss` files on top of context components. Never add plugin styles to `globals.scss`. CSS Modules automatically scope class names to prevent conflicts between plugins and with the core app.

See [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) for complete context API documentation and migration guidance.

### Test in Multiple Contexts

Verify plugin UI renders correctly in full-page view, narrow slideout (45% width), modal dialog, and mobile viewport (< 768px).

## Further Reading

- [ui-scss-modules.md](./ui-scss-modules.md) - SCSS Module architecture and naming conventions
- [ui-icons-and-feedback.md](./ui-icons-and-feedback.md) - Icon usage and ARIA label patterns
- [ui-responsive-design.md](./ui-responsive-design.md) - Container queries for responsive plugin layouts
- [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) - Plugin frontend context and CSS Modules usage
