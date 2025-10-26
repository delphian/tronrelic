# Halloween Theme

A modest seasonal theme variant featuring pumpkin orange and witchy purple colors.

## Overview

The Halloween theme is implemented as a theme variant using the existing three-layer token system. Users can toggle between the default theme and Halloween theme using the ghost icon button in the navigation bar.

## Implementation

### Theme Definition

The theme is defined in `apps/frontend/app/semantic-tokens.css` using the `[data-theme="halloween"]` selector. It overrides semantic tokens while preserving all spacing, typography, and layout tokens from the default theme.

**Color palette:**
- **Primary**: Pumpkin orange (#ff8c42)
- **Secondary**: Ghostly purple (#b794f6)
- **Success**: Eerie green (#6be651)
- **Warning**: Bright orange (#ffb347)
- **Backgrounds**: Darker purple-tinted surfaces (#0a0412, rgba(18, 8, 26, 0.88))
- **Borders**: Orange-tinted borders (rgba(255, 140, 66, 0.14))

### Theme Toggle Component

Located in `apps/frontend/components/ThemeToggle/`, the component:
- Renders a ghost icon button
- Persists theme preference to localStorage
- Updates the document root's `data-theme` attribute
- Shows an active indicator when Halloween theme is enabled
- Prevents hydration mismatches by only rendering after mount

### Usage

**Activating the theme:**
```typescript
// Programmatically
document.documentElement.setAttribute('data-theme', 'halloween');
localStorage.setItem('theme', 'halloween');

// Or use the ThemeToggle component in the NavBar
```

**Reverting to default:**
```typescript
document.documentElement.setAttribute('data-theme', 'default');
localStorage.setItem('theme', 'default');
```

**Manual activation (browser console):**
```javascript
document.documentElement.setAttribute('data-theme', 'halloween');
```

## What Changes

**Modified:**
- All color tokens (primary, secondary, success, warning, backgrounds, borders, text)
- Button gradients and shadows
- Card backgrounds and accent gradients
- Badge colors
- Input borders and focus states
- Modal backgrounds
- Toast borders
- Table backgrounds and hover states
- Alert colors
- Focus outline colors
- Gradient overlays

**Preserved:**
- All spacing tokens
- Typography (font sizes, weights, line heights)
- Border radius values
- Shadow depths
- Transition durations
- Component layouts
- Z-index layers
- Breakpoints

## Removal Instructions

When the Halloween season ends, simply remove or disable the theme toggle:

**Option 1: Remove theme toggle from NavBar**
```tsx
// In apps/frontend/components/layout/NavBar/NavBar.tsx
// Remove this line:
import { ThemeToggle } from '../../ThemeToggle';

// Remove this component from JSX:
<ThemeToggle />
```

**Option 2: Delete theme definition (optional)**
```bash
# Remove Halloween theme block from semantic-tokens.css
# Lines 404-582 in apps/frontend/app/semantic-tokens.css
```

**Option 3: Keep theme but hide toggle**
Leave the theme definition in place for future use, but remove the toggle button so users can't activate it. The theme remains available for manual activation if needed.

## Technical Details

**Theme activation flow:**
1. User clicks ghost icon in NavBar
2. `ThemeToggle` component updates localStorage (`theme: "halloween"`)
3. Component sets `data-theme="halloween"` attribute on `<html>` element
4. CSS cascade applies `[data-theme="halloween"]` overrides
5. All components automatically use new color tokens
6. No component code changes required

**Why this approach works:**
- Uses existing semantic token system (no new architecture)
- All components already reference tokens (--color-primary, etc.)
- No component refactoring needed
- Theme persists across page reloads via localStorage
- Can be easily extended for additional themes (Winter, Spring, etc.)

## Future Enhancements

If you want to expand the theme system:

1. **Additional seasonal themes**: Follow the same pattern with `[data-theme="winter"]`, `[data-theme="summer"]`, etc.
2. **Theme selector dropdown**: Replace toggle with a dropdown showing all available themes
3. **Admin theme management**: Add theme scheduling via system config (auto-enable Halloween theme from Oct 1-31)
4. **Custom user themes**: Allow users to define their own color schemes

## Files Modified

- `apps/frontend/app/semantic-tokens.css` - Added Halloween theme definition
- `apps/frontend/components/ThemeToggle/` - New component directory
  - `ThemeToggle.tsx` - Toggle button component
  - `ThemeToggle.module.css` - Component styles
  - `index.ts` - Barrel export
- `apps/frontend/components/layout/NavBar/NavBar.tsx` - Added ThemeToggle to navigation
