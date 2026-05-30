# Plugin Frontend Context — API Client

`context.api` is the injected HTTP client for plugin frontends.

## Why Injected

Direct `fetch` against hardcoded URLs breaks the universal Docker image (one image, many domains). The injected client resolves the backend base URL at runtime via `getRuntimeConfig()`, sets credentials and content-type, and throws on non-2xx so callers can wrap in try/catch.

Plugins must use `context.api` — never instantiate their own client, never read `process.env.*`, never hardcode `/api/...`.

## Interface

```typescript
interface IApiClient {
    get<T>(path: string, params?: Record<string, any>): Promise<T>;
    post<T>(path: string, body?: any): Promise<T>;
    put<T>(path: string, body?: any): Promise<T>;
    patch<T>(path: string, body?: any): Promise<T>;
    delete<T>(path: string): Promise<T>;
}
```

`path` is plugin-scoped — call `/plugins/<your-id>/...` so the backend routes to your plugin's mounted Express router (see [plugins-api-registration.md](./plugins-api-registration.md)). Admin endpoints sit at `/plugins/<your-id>/system/...` and are gated by `requireAdmin`.

## Behavior

| Concern | Handled by client |
|---------|-------------------|
| Base URL | `getRuntimeConfig()` — runtime, not build-time |
| Body serialization | JSON-stringified for `post`/`put` |
| Credentials | Cookie sent so the backend resolves the Better Auth session |
| Errors | Throws on non-2xx with response body in error |
| Typing | Generic `<T>` parameter on all methods |

## Example

```typescript
interface PluginData {
    items: Array<{ id: string; value: number }>;
    total: number;
}

export function MyPage({ context }: { context: IFrontendPluginContext }) {
    const { layout, ui, api } = context;
    const [data, setData] = useState<PluginData | null>(null);

    useEffect(() => {
        void api.get<PluginData>('/plugins/my-plugin/data', { limit: 10 })
            .then(setData)
            .catch(err => console.error('load failed', err));
    }, [api]);

    return (
        <layout.Page>
            <layout.PageHeader title="My Plugin" />
            <ui.Card>{data ? `${data.total} items` : '...'}</ui.Card>
        </layout.Page>
    );
}

// Mutations
await api.post('/plugins/my-plugin/items', { title: 'New', value: 42 });
await api.put('/plugins/my-plugin/items/123', { title: 'Updated' });
await api.delete('/plugins/my-plugin/items/123');
```

## SSR Note

Initial-render data should arrive via `serverDataFetcher`, not a `useEffect` fetch. Use `context.api` for user-triggered actions, pagination, and live refresh — not for primary content on first paint. See [plugins-frontend-context-styling.md](./plugins-frontend-context-styling.md) and [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md).

## Troubleshooting

**CORS errors.** The client uses runtime config; verify backend `SITE_URL`/`SITE_BACKEND` are set correctly in MongoDB and the backend CORS allowlist includes the frontend origin. Do not set `NEXT_PUBLIC_API_URL` — it is deprecated.

**404 on plugin route.** Confirm your plugin is enabled at `/system/plugins` and the route is declared on the plugin definition — `definePlugin({ routes: [...], adminRoutes: [...] })` or assigned before mount (e.g. `myPlugin.adminRoutes = createAdminRoutes(context)` inside `init()`). The platform mounts these under `/api/plugins/<id>/` and `/api/plugins/<id>/system/` automatically.

**401/403 on admin route.** Admin paths must be `/plugins/<id>/system/...` and the caller must be authenticated as admin — see [plugins-api-registration.md](./plugins-api-registration.md).

## Further Reading

- [plugins-frontend-context.md](./plugins-frontend-context.md) — index
- [plugins-api-registration.md](./plugins-api-registration.md) — backend route registration and admin gating
- [plugins-seo-and-ssr.md](./plugins-seo-and-ssr.md) — `serverDataFetcher` for SSR data
- [frontend-architecture.md](../frontend/frontend-architecture.md) — runtime config and `getRuntimeConfig()`
