# Plugin SEO and Server-Side Rendering

This document covers how plugin pages declare SEO metadata and pre-fetch data server-side so crawlers, social link previewers, and first-time visitors see fully populated content in the initial HTML response — without executing JavaScript.

## Why This Matters

Plugin pages used to render entirely client-side: the catch-all route delegated to a polling client component that waited for the registry to populate, then rendered the plugin component, which then fetched its own data in `useEffect`. The result was empty `<head>` tags, empty `<body>` content in the initial HTML, and a loading flash on every visit. Crawlers saw nothing meaningful, social link previews failed, and the SEO footprint was effectively zero.

The solution is twofold. First, every plugin page declares SEO fields directly in its `IPageConfig` so the catch-all route's `generateMetadata` can read them server-side and emit a fully populated `<head>`. Second, plugins that need pre-fetched body data declare a `serverDataFetcher` that the catch-all route awaits during SSR, passing the result as `initialData` to the plugin component. The plugin component initializes its state from `initialData` instead of fetching in `useEffect`. The result: real content in the initial HTML, no loading flash, and no JavaScript required for crawlers.

## How It Works

The catch-all route at `src/frontend/app/[...slug]/page.tsx` is the integration point. During SSR it calls `getEnabledPluginPageConfig(slug)` from the server-side plugin registry, which returns the `IPageConfig` only if the owning plugin is currently enabled. From there:

1. **`generateMetadata`** reads the page config's SEO fields (title, description, keywords, ogImage, ogType, canonical, structuredData, noindex) and composes a Next.js Metadata object via the existing `buildMetadata()` helper. The metadata lands in the `<head>` of the HTML response that crawlers and social scrapers receive — no JavaScript involved.

2. **The page render** awaits the page config's `serverDataFetcher` if present, passing it an `IServerDataContext` containing the backend API URL and the public site URL. The fetcher returns JSON-serializable data which the route forwards through `<PluginPageWithZones>` to `<PluginPageHandler>`, which passes it to the plugin component as the `initialData` prop. Errors from `serverDataFetcher` are caught and logged; the page renders without `initialData` rather than 500ing.

3. **The plugin component** is a `'use client'` React component. It receives `initialData` and uses it as the initial state for the data it would otherwise have fetched in `useEffect`. Static structure (headers, forms, descriptive text) renders during the SSR pass automatically because Next.js SSRs client components.

4. **After hydration**, `useEffect` runs as normal. Plugins can subscribe to WebSocket events for live updates, refetch data when client-side context warrants it (e.g., the user's local timezone differs from the SSR machine's), and handle user interactions.

Disabled plugins return `null` from the resolver and the catch-all route calls `notFound()` server-side, so disabled plugin URLs return HTTP 404 with no body — preserving the runtime-disable semantics the admin UI promises.

## SEO Fields Reference

All fields live in `IPageConfig` (`src/types/plugin/IPageConfig.ts`). Every field is optional. If `title` and `description` are both present, the catch-all route emits a full `<head>` populated via `buildMetadata()`. If they're absent, the route emits an empty metadata object and Next.js falls back to the layout-level defaults.

| Field | Purpose |
|-------|---------|
| `title` | `<title>`, `og:title`, `twitter:title` |
| `description` | `<meta description>`, `og:description`, `twitter:description` |
| `keywords` | `<meta name="keywords">` |
| `ogImage` | `og:image`, `twitter:image` (relative paths resolve against siteUrl — see [Plugin-Owned OG Images](#plugin-owned-og-images)) |
| `ogType` | `og:type` — defaults to `'website'`, use `'article'` for time-stamped content |
| `canonical` | Override the canonical URL (defaults to the page's `path`) |
| `noindex` | Adds `<meta name="robots" content="noindex,nofollow">` for admin pages |
| `structuredData` | Schema.org JSON-LD object injected as `<script type="application/ld+json">` |

## serverDataFetcher Pattern

`serverDataFetcher` is an optional async function on `IPageConfig` that runs during SSR. Its return value becomes the `initialData` prop on the plugin component.

```typescript
serverDataFetcher?: (ctx: IServerDataContext) => Promise<unknown>;
```

`IServerDataContext` exposes the values plugins need for backend fetches:

| Field | Description |
|-------|-------------|
| `apiBaseUrl` | Backend API base URL with `/api` suffix (Docker-internal in containers, localhost otherwise) |
| `siteUrl` | Public site URL from runtime config |

The returned data **must be JSON-serializable** because it crosses the React Server Components boundary. Functions, class instances, Maps, Sets, and component references will fail. Stick to plain objects, arrays, strings, numbers, booleans, and `null`.

## Canonical Example: bazi-fortune

The bazi-fortune plugin demonstrates both halves of the pattern. See `src/plugins/trp-bazi-fortune/src/frontend/frontend.ts` for the page config and `src/plugins/trp-bazi-fortune/src/frontend/BaziPage.tsx` for the component.

The page config declares full SEO metadata (title, description, keywords, ogType, structuredData with a `WebApplication` schema) and a `serverDataFetcher` that fetches today's day pillar from the bazi backend endpoint:

```typescript
serverDataFetcher: async (ctx) => {
    const now = new Date();
    const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const url = `${ctx.apiBaseUrl}/plugins/bazi-fortune/day-pillar?date=${date}`;
    const response = await fetch(url, { next: { revalidate: 60 } });
    if (!response.ok) {
        return null;
    }
    const data = await response.json();
    return { dayPillar: data.dayPillar, date };
}
```

The component initializes its day-pillar state from `initialData` instead of fetching in `useEffect`:

```typescript
const ssrData = initialData as IBaziInitialData | undefined;
const [dayPillar, setDayPillar] = useState<ISexagenaryPair | null>(ssrData?.dayPillar ?? null);
```

A client `useEffect` still runs after hydration, but it short-circuits when the SSR date matches the user's local date — only re-fetching when the user is in a forward timezone past UTC midnight where "today" means a different day pillar:

```typescript
useEffect(() => {
    const localDate = getLocalDateString();
    if (ssrData && ssrData.date === localDate) {
        return;  // SSR data is correct for this user
    }
    // ... fetch with localDate
}, [api, ssrData]);
```

The user-triggered fetch (entering a wallet address and clicking "Read Fortune") stays client-only — it doesn't belong in `serverDataFetcher` because it depends on user input, not on what should appear in the initial HTML.

## Plugin-Owned OG Images

OG images, manifest icons, and any other static assets that external consumers cache long-term need stable, unfingerprinted URLs. Webpack-imported assets (the `src/frontend/assets/` convention) get hashed paths that change every build, which breaks social previews already cached by Facebook, Twitter, Discord, and Slack for weeks at a time. The plugin static asset convention solves this without coupling the asset to the core frontend's `public/` directory.

Drop static files in `src/plugins/<plugin-id>/src/frontend/public/`. The frontend plugin registry generator (`scripts/generate-frontend-plugin-registry.mjs`) mirrors that directory into `src/frontend/public/plugins/<plugin-id>/` before every dev startup and every production build, so Next.js's static file server picks the files up automatically. Reference the deployed path as `/plugins/<plugin-id>/<file>` from your `IPageConfig.ogImage`, page components, or anywhere else in the plugin. The destination directory is git-ignored because it is a build artifact reproducible from the plugin sources.

The bazi-fortune plugin demonstrates the pattern. The 1200×630 OG image lives at `src/plugins/trp-bazi-fortune/src/frontend/public/og-bazi-fortune.jpg` and is referenced from the page config:

```typescript
ogImage: '/plugins/bazi-fortune/og-bazi-fortune.jpg',
```

After adding or replacing assets, run `npm run generate:plugins` (or restart `npm run dev`, which calls the generator on startup) so the destination directory is refreshed. Removed and renamed plugins clean up automatically because the destination is wiped at the start of each generator run.

## Common Pitfalls

**Non-serializable data.** If `serverDataFetcher` returns a `Date`, `Map`, or class instance, the React Server Components serialization step throws. Convert to ISO strings, plain arrays, and plain objects before returning.

**Timezone-sensitive content.** The server has no concept of "the user's timezone." If your data depends on the user's local date (like bazi's day pillar), include the SSR-side date in `initialData` so the client `useEffect` can detect a mismatch and re-fetch only when needed. Don't unconditionally re-fetch — that defeats the purpose.

**Loading states for SSR data.** Don't render a `<Skeleton>` or "Loading..." placeholder for data that arrived via `initialData`. Initialize state directly: `useState(initialData?.field ?? null)`. The skeleton only makes sense if `initialData` is `undefined` AND the component is still trying to fetch.

**Forgetting `noindex` on admin pages.** Plugin admin/settings pages should set `noindex: true` so search engines don't index them. Public pages don't need this.

**Importing frontend internals from `serverDataFetcher`.** The page config lives in the plugin workspace, which can't import from `apps/frontend`. Use the `IServerDataContext` parameter for URLs instead of importing helpers directly.

## Pre-Implementation Checklist

Before adding SEO and SSR to a plugin page, verify:

- [ ] `title` and `description` are populated with crawler-friendly copy
- [ ] `keywords` reflect terms users would actually search
- [ ] `ogType` is set explicitly (`'website'` or `'article'`)
- [ ] `structuredData` includes a Schema.org `@type` appropriate for the page
- [ ] Admin pages have `noindex: true`
- [ ] If the page needs pre-fetched data, `serverDataFetcher` returns JSON-serializable values
- [ ] The plugin component accepts `initialData` and initializes state from it
- [ ] Client-side `useEffect` only re-fetches when context warrants (timezone, user input, live updates)
- [ ] No `<Skeleton>` or loading state for data that arrives via `initialData`
- [ ] Tested with `curl <URL>` to confirm metadata and content appear in initial HTML

## Further Reading

**Plugin documentation:**
- [plugins-page-registration.md](./plugins-page-registration.md) — Page registration, menu items, and admin pages
- [plugins-frontend-context.md](./plugins-frontend-context.md) — Plugin context injection and UI components
- [plugins-system-architecture.md](./plugins-system-architecture.md) — Plugin loader, lifecycle hooks, and runtime flow

**Frontend documentation:**
- [react.md](../frontend/react/react.md#ssr--live-updates-pattern) — Complete SSR + Live Updates pattern guide for core components
- [ui-ssr-hydration.md](../frontend/ui/ui-ssr-hydration.md) — Hydration error prevention and `ClientTime` component
