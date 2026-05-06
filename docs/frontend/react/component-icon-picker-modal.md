# IconPickerModal Component

A searchable grid of all renderable Lucide React icons. Drop-in content for a `ModalProvider` modal — does not manage its own modal lifecycle.

## Why This Matters

Free-text icon-name fields force users to guess available exports and produce typos that fail silently at render. IconPickerModal replaces that with a browsable grid, real-time search, and a returned name that is guaranteed to be a valid Lucide export.

## How It Works

The component is **content-only** — it renders inside a modal opened via `useModal()`. It accepts the current icon name (for highlighting), an `onSelect` callback that fires the chosen icon's PascalCase export name, and an `onClose` callback that the parent uses to dismiss the modal.

Internally it enumerates `lucide-react`'s exports and filters out non-renderable entries — utilities (`createLucideIcon`, `icons`, `Icon`), the `LucideXxx` and `XxxIcon` alias families, and anything missing a `displayName`. The visible grid is the de-aliased list, so the names you receive in `onSelect` are the canonical exports (e.g. `Snowflake`, never `LucideSnowflake` or `SnowflakeIcon`).

`ModalProvider` is composed once in `src/frontend/app/providers.tsx` (see [react.md → Provider Composition](./react.md#provider-composition)) — do not add a second one. If `useModal()` throws "must be used within a ModalProvider," check that you are inside the global provider tree, not that you need to wrap your component in another one.

## Props

```typescript
export interface IconPickerModalProps {
    selectedIcon?: string;          // PascalCase Lucide export name to highlight
    onSelect: (name: string) => void; // Receives PascalCase name; component then calls onClose()
    onClose: () => void;            // Must invoke ModalProvider's close(modalId)
}
```

The component invokes `onSelect` then `onClose` on every selection — there is no confirm step, no multi-select.

## Example

```tsx
'use client';

import { useState } from 'react';
import { useModal } from '../../../components/ui/ModalProvider';
import { IconPickerModal } from '../../../components/ui/IconPickerModal';
import { Button } from '../../../components/ui/Button';

export function IconField() {
    const { open, close } = useModal();
    const [icon, setIcon] = useState('Sparkles');

    const pick = () => {
        const id = open({                   // capture id — needed to close later
            title: 'Select Icon',
            size: 'lg',                     // sm/md crowd the grid; lg or xl recommended
            content: (
                <IconPickerModal
                    selectedIcon={icon}
                    onSelect={setIcon}
                    onClose={() => close(id)} // closure over id, not a stale ref
                />
            ),
            dismissible: true
        });
    };

    return <Button onClick={pick}>Choose Icon ({icon})</Button>;
}
```

## Gotchas

**Capture the modal id.** `useModal().open()` returns the id; `close()` requires it. A common bug is writing `onClose={close}` — that closes nothing because `close` needs an argument. Wrap it as `() => close(id)` inside the `open()` call so the closure captures the freshly-returned id.

**Names are PascalCase Lucide exports.** `selectedIcon` only highlights when it matches the export exactly: `'CheckCircle'`, not `'checkCircle'` or `'check-circle'`. If your storage layer uses kebab-case, transform inside `onSelect` before persisting.

**Use `size: 'lg'` or `'xl'`.** Smaller modal sizes still render but reduce the grid to 1–2 columns and force excessive scrolling.

**No virtualization.** All filtered icons render to the DOM. Lucide's ~1500 exports filter down to ~700 renderable icons — fast enough on modern devices but worth knowing if you profile.

**No multi-select.** Selecting closes the modal immediately. If you need multiple selections, wrap the component yourself and reopen between picks.

## Styling

CSS Modules (`IconPickerModal.module.css`) scoped to the component, container queries on `container-name: icon-picker` to adapt grid columns to modal width (not viewport).

The component's existing SCSS predates the project's 4-tier token rule and references foundation primitives (`--spacing-N`, `--font-size-xs/sm/md`). When adding new component CSS in this codebase, prefer the use-case semantics and curated t-shirt primitives — see [ui-design-token-layers.md](../ui/ui-design-token-layers.md) for the tier rules and [ui-scss-modules.md](../ui/ui-scss-modules.md) for the component-styling workflow.

## Pre-Use Checklist

- [ ] Caller is a client component (`'use client'`)
- [ ] `useModal()` resolves — i.e. caller is inside the global `Providers` tree
- [ ] `open()` called with `size: 'lg'` or `'xl'`
- [ ] Returned id captured and passed to `close(id)` inside `onClose`
- [ ] `selectedIcon` value is the exact PascalCase Lucide export

## Further Reading

- [react.md](./react.md) — Provider composition, where `ModalProvider` lives
- [ui-scss-modules.md](../ui/ui-scss-modules.md) — Component styling workflow
- [ui-design-token-layers.md](../ui/ui-design-token-layers.md) — Token tier rules
- [ui-accessibility.md](../ui/ui-accessibility.md) — ARIA, focus, keyboard navigation rules
- [ui-theme.md](../ui/ui-theme.md) — Theme system using IconPickerModal in admin
