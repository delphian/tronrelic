# IconPickerModal Component

A searchable, responsive icon selection interface that displays all available Lucide React icons in a browsable grid. Enables visual icon discovery and selection without requiring users to memorize icon names.

## Who This Component Is For

Frontend developers implementing forms, configuration interfaces, or any feature requiring users to select icons visually. Particularly useful for theme management, menu item configuration, plugin settings, and user-customizable navigation.

## Why This Matters

Text input fields for icon names create poor user experience:

- **Users don't know what icons exist** - Without browsing, they can't discover available options
- **Typos break functionality** - Misspelled icon names fail silently or cause rendering errors
- **No visual preview** - Users can't see what an icon looks like before selection
- **Requires documentation** - Teams need to maintain icon name lists separately

IconPickerModal solves these problems by providing immediate visual feedback, real-time search, and guaranteed valid icon selections.

## Core Features

### Visual Icon Browser

Displays all Lucide React icons (400+ components) in a responsive grid with icon previews and names. The grid uses container queries to adapt column count based on modal width, ensuring consistent appearance regardless of where the modal is rendered.

### Real-Time Search

Filter icons by name using case-insensitive substring matching. As users type, the grid updates instantly to show matching icons. Search results include a count indicator (e.g., "47 icons found") and an empty state with a "Clear search" button when no matches exist.

### Selection State Management

Highlights the currently selected icon with primary color accent and border styling. When users click an icon, the selection handler fires and the modal closes automatically. The component supports pre-selection, allowing forms to display the current choice when reopening the picker.

### Accessible Design

- Keyboard navigation with visible focus states for all icon buttons
- ARIA labels on interactive elements ("Select [IconName] icon")
- Proper semantic HTML with button elements for selections
- Screen reader announcements for result counts and empty states

## Props Interface

```typescript
export interface IconPickerModalProps {
    /** Currently selected icon name (e.g., 'Sparkles') */
    selectedIcon?: string;
    /** Callback invoked when user selects an icon */
    onSelect: (iconName: string) => void;
    /** Callback to close the modal */
    onClose: () => void;
}
```

**Prop descriptions:**

- `selectedIcon` - Optional. Highlights the specified icon in the grid. Use this when editing existing configurations to show the user's current selection.
- `onSelect` - Required. Receives the selected icon's component name (e.g., `'Sparkles'`, `'Settings'`, `'CheckCircle'`). The modal closes automatically after invoking this callback.
- `onClose` - Required. Called when the user clicks "Cancel" or when selection completes. Must close the modal by calling the ModalProvider's `close()` method.

## Integration Requirements

### ModalProvider Dependency

IconPickerModal **must** be rendered within a modal opened via `ModalProvider`. It does not manage its own modal state—it expects to receive `onClose` from a parent modal context.

**Required setup in application root** (`app/layout.tsx`):

```tsx
import { ModalProvider } from '../components/ui/ModalProvider';

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html>
            <body>
                <ReduxProvider>
                    <ModalProvider>
                        {children}
                    </ModalProvider>
                </ReduxProvider>
            </body>
        </html>
    );
}
```

If `ModalProvider` is not present, the `useModal()` hook will throw an error at runtime.

### Icon Rendering Requirements

The component uses dynamic imports from `lucide-react` to access all icon components. No additional icon configuration or registration is required—all Lucide icons are automatically available.

## Usage Examples

### Basic Usage with Form State

```tsx
'use client';

import { useState } from 'react';
import { useModal } from '../../../components/ui/ModalProvider';
import { IconPickerModal } from '../../../components/ui/IconPickerModal';
import { Button } from '../../../components/ui/Button';

export function ThemeForm() {
    const { open: openModal, close: closeModal } = useModal();
    const [iconName, setIconName] = useState('Sparkles');

    const handleOpenIconPicker = () => {
        const modalId = openModal({
            title: 'Select Icon',
            size: 'lg',
            content: (
                <IconPickerModal
                    selectedIcon={iconName}
                    onSelect={(name) => setIconName(name)}
                    onClose={() => closeModal(modalId)}
                />
            ),
            dismissible: true
        });
    };

    return (
        <div>
            <label>Icon</label>
            <Button onClick={handleOpenIconPicker}>
                Choose Icon
            </Button>
            <p>Selected: {iconName}</p>
        </div>
    );
}
```

### With Pre-Selected Icon

```tsx
const handleEditMenuItem = (menuItem: MenuItem) => {
    const modalId = openModal({
        title: 'Edit Menu Item',
        size: 'lg',
        content: (
            <IconPickerModal
                selectedIcon={menuItem.icon} // Show current selection
                onSelect={(iconName) => {
                    updateMenuItem({ ...menuItem, icon: iconName });
                }}
                onClose={() => closeModal(modalId)}
            />
        ),
        dismissible: true
    });
};
```

### Integration with Redux Form State

```tsx
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { updateThemeIcon } from '../../../../features/system/themeSlice';

export function ThemeEditor() {
    const dispatch = useAppDispatch();
    const theme = useAppSelector((state) => state.theme.selectedTheme);
    const { open: openModal, close: closeModal } = useModal();

    const handleSelectIcon = () => {
        const modalId = openModal({
            title: 'Select Theme Icon',
            size: 'lg',
            content: (
                <IconPickerModal
                    selectedIcon={theme?.icon}
                    onSelect={(iconName) => {
                        dispatch(updateThemeIcon({ id: theme.id, icon: iconName }));
                    }}
                    onClose={() => closeModal(modalId)}
                />
            ),
            dismissible: true
        });
    };

    return <Button onClick={handleSelectIcon}>Pick Icon</Button>;
}
```

### Custom onSelect Handler with Validation

```tsx
const handleOpenIconPicker = () => {
    const modalId = openModal({
        title: 'Select Plugin Icon',
        size: 'lg',
        content: (
            <IconPickerModal
                selectedIcon={formData.icon}
                onSelect={async (iconName) => {
                    // Validate icon name against backend API
                    const isValid = await validateIcon(iconName);
                    if (isValid) {
                        setFormData({ ...formData, icon: iconName });
                    } else {
                        console.error('Invalid icon selected:', iconName);
                    }
                }}
                onClose={() => closeModal(modalId)}
            />
        ),
        dismissible: true
    });
};
```

## Styling System

### Design Token Usage

IconPickerModal uses semantic tokens from `semantic-tokens.css` for all styling. This ensures consistent visual appearance across themes and makes the component automatically adapt to dark mode and custom color schemes.

**Key design tokens used:**

- **Colors**: `--color-primary`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-surface`, `--color-background`
- **Spacing**: `--spacing-4`, `--spacing-5`, `--spacing-7`, `--spacing-12`
- **Typography**: `--font-size-xs`, `--font-size-sm`, `--font-size-md`
- **Borders**: `--radius-md`, `--border-width-thin`, `--border-width-medium`
- **Transitions**: `--transition-base`
- **Shadows**: `--shadow-sm`, `--focus-shadow`

### CSS Modules Scope

All component styles are scoped using CSS Modules (`IconPickerModal.module.css`). This prevents style conflicts with other components and ensures the picker renders consistently in any context.

### Container Queries for Responsiveness

The component uses container queries instead of viewport media queries, allowing it to respond to the modal's width rather than the viewport size. This ensures proper layout whether the modal is rendered on mobile, desktop, or within constrained contexts like sidebars.

**Responsive breakpoints:**

```css
/* Default: 2-3 columns (100px minimum) */
.icon_grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
}

/* 600px+: 3-4 columns (110px minimum) */
@container icon-picker (min-width: 600px) {
    .icon_grid {
        grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    }
}

/* 800px+: 4-5 columns (120px minimum) */
@container icon-picker (min-width: 800px) {
    .icon_grid {
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    }
}
```

### Customization Options

The component does not support custom className props to maintain visual consistency. If you need to customize appearance:

1. Use modal size variants (`sm`, `md`, `lg`, `xl`) to control overall width
2. Modify design tokens in `semantic-tokens.css` to change colors system-wide
3. Override CSS Module classes using CSS specificity (not recommended—prefer token changes)

## Accessibility Features

### Keyboard Navigation

- **Tab**: Navigate between search input, icon buttons, and Cancel button
- **Enter/Space**: Select focused icon or activate Cancel button
- **Escape**: Close modal (when dismissible)
- **Arrow keys**: Navigate within icon grid (browser default focus behavior)

### Screen Reader Support

- Search input has `aria-label="Search icons"`
- Each icon button has descriptive `aria-label="Select [IconName] icon"`
- Icon SVGs have `aria-hidden={true}` to prevent duplicate announcements
- Results count announces number of matching icons
- Empty state provides clear "No icons found" messaging

### Focus Management

- All interactive elements have visible focus states using `--focus-outline-width`, `--color-focus`, and `--focus-shadow` design tokens
- Focus states use high-contrast colors meeting WCAG AA standards
- Focus outline offset prevents overlap with element borders

### Color Contrast

- Text meets WCAG AA contrast requirements against backgrounds
- Selected state uses `--color-primary` with sufficient contrast
- Hover states increase surface elevation without reducing contrast

## Known Limitations

### Performance with Large Icon Sets

Lucide React currently provides 400+ icons. Rendering all icons simultaneously may cause brief delay on low-end devices. The component mitigates this by:

- Using `useMemo` to avoid unnecessary filtering recalculations
- Rendering icons on-demand (only visible icons in scrollable container)
- Deferring modal rendering until opened (not pre-rendered)

If performance becomes an issue with larger icon sets, consider implementing virtualization using `react-window` or `react-virtual`.

### Icon Name Format

The component returns icon names exactly as exported from `lucide-react` (PascalCase, e.g., `'CheckCircle'`, not `'check-circle'`). If your API expects kebab-case or other formats, transform the name in your `onSelect` handler:

```tsx
onSelect={(iconName) => {
    const kebabCase = iconName
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
    saveIcon(kebabCase);
}}
```

### Modal Size Recommendation

Always use `size: 'lg'` or `size: 'xl'` when opening IconPickerModal. Smaller sizes (`sm`, `md`) will render correctly but provide suboptimal user experience due to reduced grid columns and excessive scrolling.

### No Multi-Select Support

IconPickerModal supports selecting a single icon only. If you need multi-select functionality, implement a custom wrapper component that tracks multiple selections and reopens the modal for additional picks.

## Related Components

- **ModalProvider** - Required modal context provider (see `apps/frontend/components/ui/ModalProvider`)
- **Button** - Used for modal triggers and Cancel action (see `apps/frontend/components/ui/Button`)
- **Input** - Search input field (see `apps/frontend/components/ui/Input`)

## Related Documentation

- [Frontend Component Guide](../../ui/ui-component-styling.md) - CSS Modules and design token reference
- [Frontend Architecture](../../frontend-architecture.md) - Component organization patterns
- [System Theme Management](../../../system/system-theme.md) - Example usage in theme editor (if exists)

## Pre-Implementation Checklist

Before using IconPickerModal in a new feature, verify:

- [ ] `ModalProvider` is present in application root (`app/layout.tsx`)
- [ ] Modal is opened with `size: 'lg'` or larger for optimal experience
- [ ] `onSelect` handler updates form state or dispatches Redux action
- [ ] `onClose` handler calls `closeModal(modalId)` to properly close the modal
- [ ] Pre-selected icon name (if any) matches Lucide React export exactly (PascalCase)
- [ ] Icon name is stored and retrieved consistently (not transformed mid-lifecycle)
- [ ] Component is rendered client-side (uses `'use client'` directive if in Server Component tree)
- [ ] Tested in both light and dark themes to verify design token usage
- [ ] Tested with keyboard navigation to ensure focus states are visible
- [ ] Verified behavior on mobile viewports with touch interactions

## Common Integration Patterns

### Pattern: Icon Preview in Form

Display the selected icon next to the picker button:

```tsx
import * as LucideIcons from 'lucide-react';

function IconField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
    const { open: openModal, close: closeModal } = useModal();
    const IconComponent = LucideIcons[value as keyof typeof LucideIcons] as React.ComponentType<{ size?: number }>;

    const handleOpenPicker = () => {
        const modalId = openModal({
            title: 'Select Icon',
            size: 'lg',
            content: (
                <IconPickerModal
                    selectedIcon={value}
                    onSelect={onChange}
                    onClose={() => closeModal(modalId)}
                />
            )
        });
    };

    return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {IconComponent && <IconComponent size={24} />}
            <span>{value || 'No icon selected'}</span>
            <Button onClick={handleOpenPicker}>Change Icon</Button>
        </div>
    );
}
```

### Pattern: Icon Selection with Save Confirmation

Defer saving until user confirms changes:

```tsx
function EditMenuItemModal({ item }: { item: MenuItem }) {
    const [draft, setDraft] = useState({ ...item });
    const { open: openModal, close: closeModal } = useModal();

    const handleOpenIconPicker = () => {
        const modalId = openModal({
            title: 'Select Icon',
            size: 'lg',
            content: (
                <IconPickerModal
                    selectedIcon={draft.icon}
                    onSelect={(iconName) => {
                        setDraft({ ...draft, icon: iconName });
                    }}
                    onClose={() => closeModal(modalId)}
                />
            )
        });
    };

    const handleSave = async () => {
        await updateMenuItem(draft);
        // Parent modal closes after save
    };

    return (
        <div>
            <label>Icon</label>
            <Button onClick={handleOpenIconPicker}>Choose Icon</Button>
            <p>Selected: {draft.icon}</p>
            <Button onClick={handleSave}>Save Changes</Button>
        </div>
    );
}
```

### Pattern: Reset to Default Icon

Allow users to clear selection or reset to system default:

```tsx
const handleResetIcon = () => {
    setFormData({ ...formData, icon: 'Sparkles' }); // Default icon
};

return (
    <div>
        <Button onClick={handleOpenIconPicker}>Choose Icon</Button>
        <Button variant="ghost" onClick={handleResetIcon}>Reset to Default</Button>
    </div>
);
```

## Troubleshooting

### Modal Not Opening

**Symptom:** Clicking the button does nothing, no modal appears.

**Cause:** `ModalProvider` is missing or not wrapping the component tree.

**Solution:** Verify `ModalProvider` is present in `app/layout.tsx`:

```tsx
<ModalProvider>
    {children}
</ModalProvider>
```

### Icon Not Highlighted

**Symptom:** Previously selected icon doesn't show highlighted state when modal opens.

**Cause:** `selectedIcon` prop value doesn't match Lucide export name (wrong case or spelling).

**Solution:** Ensure icon name is exact PascalCase match:

```tsx
// Correct
selectedIcon="CheckCircle"

// Incorrect
selectedIcon="checkCircle"
selectedIcon="check-circle"
```

### Modal Doesn't Close on Selection

**Symptom:** After clicking an icon, the modal stays open.

**Cause:** `onClose` handler not calling `closeModal(modalId)`.

**Solution:** Capture modal ID and pass it to `onClose`:

```tsx
const modalId = openModal({ /* ... */ });

<IconPickerModal
    onClose={() => closeModal(modalId)} // Must close the modal
/>
```

### Icons Not Rendering

**Symptom:** Grid shows empty buttons with labels but no icon graphics.

**Cause:** Lucide React package not installed or imported incorrectly.

**Solution:** Verify `lucide-react` is installed:

```bash
npm list lucide-react
```

If missing, install it:

```bash
npm install lucide-react --workspace apps/frontend
```

### Search Not Working

**Symptom:** Typing in search box doesn't filter icons.

**Cause:** Component state issue or React rendering problem.

**Solution:** Check browser console for errors. Ensure component is rendered client-side (not SSR) by adding `'use client'` directive to parent component.
