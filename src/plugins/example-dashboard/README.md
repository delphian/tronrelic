# Example Dashboard Plugin

This plugin demonstrates TronRelic's centralized menu/page system. It shows how plugins can:

- Register navigation menu items
- Define routable pages
- Extend the UI without modifying core infrastructure

## Features

- **Menu Integration**: Adds "Example" to the main navigation
- **Custom Page**: Provides a dashboard at `/example-dashboard`
- **Zero Core Changes**: Everything is self-contained in the plugin

## Structure

```
example-dashboard/
├── src/
│   ├── manifest.ts              # Plugin metadata
│   └── frontend/
│       ├── frontend.ts          # Plugin entry with menu/page config
│       └── ExampleDashboardPage.tsx  # Page component
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

1. **Manifest** declares this is a frontend-only plugin
2. **Menu Item** is registered with label, href, icon, and order
3. **Page Config** maps `/example-dashboard` to the React component
4. **Plugin Loader** automatically discovers and registers everything
5. **Dynamic Route** renders the component when users visit the URL

## Creating Your Own Plugin

1. Copy this plugin as a template
2. Update the manifest with your plugin ID and metadata
3. Define your menu items and pages in `frontend.ts`
4. Implement your page components
5. Build and restart the app

The system will automatically:
- Add your menu items to the navigation
- Route your pages correctly
- Handle loading states and errors

## Configuration Options

### Menu Items

```typescript
menuItems: [
    {
        label: string;        // Display text
        href: string;         // URL path
        icon?: string;        // Lucide icon name
        category?: string;    // Menu grouping
        order?: number;       // Sort position
        adminOnly?: boolean;  // Requires admin
        featured?: boolean;   // Highlight the item
    }
]
```

### Pages

```typescript
pages: [
    {
        path: string;              // URL route
        component: ComponentType;  // React component
        title?: string;            // Page title (meta)
        description?: string;      // Page description (meta)
        requiresAuth?: boolean;    // Auth required
        requiresAdmin?: boolean;   // Admin required
    }
]
```

## No Backend Required

This plugin is frontend-only (`backend: false` in manifest). If you need backend functionality:

1. Set `backend: true` in the manifest
2. Create `src/backend/backend.ts`
3. Implement observers or API routes
4. Build the backend code with `npm run build`

See the [plugin system documentation](../../../docs/plugins/plugins.md) for details.
