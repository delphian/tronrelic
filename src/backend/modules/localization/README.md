# Localization Module

Serves the site in languages other than English. Administrators add languages, publish routes in them one at a time, and store translations ahead of time; the frontend serves each translated page at its own `/<code>/...` address from memory, with no translation happening while a visitor waits. With no language enabled the module changes nothing: every URL stays English and every page renders exactly as before.

## Quick Reference

| | |
|---|---|
| Module id | `localization` |
| Service registry name | `'localization'` → `ILocalizationService` (read-only: snapshot, catalog, `translate`, `getLanguagesForPath`) |
| Admin UI | `/system/localization` — Languages, Routes, Translations, Database, Logs tabs |
| Public API | `/api/localization` |
| Admin API | `/api/admin/system/localization` (`requireAdmin`, grouped rate limiter) |
| Types | `@/types` → `packages/types/src/localization/` (contracts plus the shared helpers `matchRoutePattern`, `isValidRoutePattern`, `resolveLocalizedPath`, `findPublishedLanguages`, `localizePath`, `localizeHref`, `interpolateTranslation`, `DEFAULT_LANGUAGE`) |
| Frontend hooks | `useTranslation`, `useLocalization`, `useLocalizedHref` |
| Storage | `module_localization_languages`, `module_localization_routes`, `module_localization_keys`, `module_localization_translations` |
| Frontend module | `src/frontend/modules/localization/` — `LocalizationProvider`, `useTranslation`, `LanguageSwitcher`, admin tabs; server-only helpers in `./server`, including `getServerTranslator` and `fetchLocalizationSeed` |
| Plugin API | `context.useTranslation()` on `IFrontendPluginContext`, keys scoped to the plugin id |
| Widget | `core:language-switcher` (widgets module catalog) |
| Log service | `tronrelic:localization` — missing-translation warnings land here |
| Menu | "Localization" under the System container; tab nodes in the `localization` namespace |

## How a Request Is Served

Every page lives under `src/frontend/app/[lang]/`. The Next.js middleware reads the public snapshot (cached 60 seconds, the same cache it keeps for the redirect map) and decides the language:

1. `/markets` is English. The middleware rewrites it internally to `/en/markets`; the address bar never changes.
2. `/zh/markets` is Chinese only when `zh` is enabled **and** a route covering `/markets` lists `zh`. Otherwise the whole path is treated as an English path, so it 404s, and a disabled language never takes over a page that already lives at `/zh/...`.
3. Public files (`/images/*.png`, `/plugins/*.js`, `/icon.png`) pass through untouched so Next.js can serve them.

The middleware sets the `x-tronrelic-language` request header to the language it chose and `x-pathname` to the path without the prefix. The `(site)` layout returns 404 for any request whose `[lang]` value the middleware did not set, which is what stops `/images/about` from rendering the About page. The root layout fetches the snapshot and, for a non-English page, the catalog (both through the Next.js fetch cache), writes `<html lang dir>` and the `hreflang` links, and seeds `LocalizationProvider`. Components call `t(key, englishText)`; the same lookup runs on the server and in the browser, so hydration matches.

A language change is a change of the `[lang]` segment, so Next.js re-renders the root layout and the `<html lang>` attribute and surrounding chrome switch with it. The switcher uses plain links for the same reason.

## Rollout Workflow

1. **Languages tab** — add the language. It starts disabled; nothing changes for visitors.
2. **Translations tab** — keys appear as the site renders them. Pick the language and translate, narrowing the list by namespace, status, published route, or text. A key whose English changed after its translation was saved shows as *stale*.
3. **Routes tab** — publish the route pattern in the language. The missing count shows how many keys rendered on that route still lack a translation; "Show keys" opens the Translations tab filtered to them.
4. **Languages tab** — enable the language. Enabling is refused when existing CMS pages or menu URLs already start with `/<code>/`.
5. Place the **Language switcher** widget (`/system/widgets`) so visitors can reach the translated pages. It renders nothing on English-only pages.

A translated page that falls back to English for a missing key still renders; the frontend reports it and the backend logs a warning once per language and key per process (Logs tab).

## Translating Text in Code

Core components: `const { t } = useTranslation();` from `modules/localization` (namespace `core`). Plugins: `const { t } = context.useTranslation();` (namespace is the plugin id). Write the English text at the call site and keep the key stable when only the wording changes, so existing translations are flagged stale rather than lost:

```tsx
const { t } = context.useTranslation();
return <layout.PageHeader title={t('page.title', 'Energy Markets')} subtitle={t('page.count', '{count} markets', { count })} />;
```

Server code that cannot call a hook, chiefly a page's `generateMetadata`, uses `getServerTranslator(params)` from `modules/localization/server`. It returns the same translator, built from the same seed the root layout uses, and its `language` is the value to pass to `buildMetadata`, so a translated page sends search engines a translated title and description. `/about` is the reference:

```tsx
const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);
return buildMetadata({ siteUrl, language, title: t('about.meta.title', 'About TronRelic'), path: '/about' });
```

Pass values as `{name}` placeholders instead of concatenating, so a translator can move them. There is no plural support; use separate keys. Backend code producing visitor-facing text calls `serviceRegistry.get<ILocalizationService>('localization')?.translate(namespace, key, language, englishText, params)`.

**Links keep the visitor in their language.** Stored links, such as menu URLs, are unprefixed, so on a Chinese page a link to `/markets` would drop the visitor back into English. Prefixing every link is not safe either, because `/zh/x` returns 404 unless `x` is published in Chinese. `localizeHref(href, language, config)` in `@/types` applies the middleware's rule: it adds the prefix only when the target is live in the page's language, keeps any query string or fragment, and leaves English pages and off-site links alone. Client components call `const localize = useLocalizedHref()` and render `href={localize(url)}`; server components build the same function from `fetchLocalizationSeed(lang)`. Menus (`MenuNavClient`) and category landing pages use it today. Other links across the site are still unprefixed and should adopt it as they are touched.

**Only text rendered on the server is reported.** Text that only appears after an interaction (a modal, a toast) is translated if a translation exists, but its key is not discovered automatically — add it on the Translations tab. CMS page bodies are content, not interface text, and are not translated by this module.

## Public REST

| Method | Path | Notes |
|---|---|---|
| GET | `/api/localization/config` | `ILocalizationPublicConfig`: enabled languages and routes with their enabled languages only. `Cache-Control: public, max-age=60` |
| GET | `/api/localization/catalog/:language` | `ITranslationCatalog`. Empty for `en`. Same cache header |
| POST | `/api/localization/observations` | `{ observations: ITranslationObservation[] }` → 204. **Frontend container only**: refused (403) when any proxy header (`x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, `forwarded`) is present or the peer is not a private address. Rate-limited 600/min |

Observations are validated: the namespace must be `core` or a discovered plugin id, keys match `^[A-Za-z0-9_.:-]{1,200}$`, sources are capped at 2,000 characters, batches at 200, and the collection at 20,000 keys. The frontend reports each key with at most five paths per server process.

## Admin REST

All under `/api/admin/system/localization`. Errors: 400 validation, 404 not found, 409 conflict, each with `{ error }`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/languages` | — | `{ languages: ILanguageSummary[] }` with translated/stale/missing counts |
| POST | `/languages` | `{ code, name, nativeName, direction? }` | `{ language }` 201; starts disabled; `en` refused |
| PATCH | `/languages/:code` | `{ name?, nativeName?, direction?, enabled? }` | `{ language }`; enabling refused (409) when known paths start with `/<code>` |
| DELETE | `/languages/:code` | — | 204; deletes its translations, removes it from routes, drops emptied routes |
| GET | `/routes` | — | `{ routes: ILocalizedRouteSummary[] }` with `keyCount` and `missingByLanguage` |
| POST | `/routes` | `{ pattern, languages }` | `{ route }` 201 |
| PATCH | `/routes/:id` | `{ pattern?, languages? }` | `{ route }` |
| DELETE | `/routes/:id` | — | 204 |
| GET | `/namespaces` | — | `{ namespaces: ITranslationNamespaceSummary[] }` |
| GET | `/translations` | `language` (required), `namespace`, `status`, `search`, `route`, `limit` ≤ 200, `offset` | `ITranslationPage` |
| PUT | `/translations` | `{ namespace, key, language, text }` | `{ translation }`; key and language must exist |
| DELETE | `/translations` | `?namespace&key&language` | 204 |
| POST | `/keys` | `{ namespace, key, source }` | `{ key }` 201, `origin: 'manual'` |
| DELETE | `/keys` | `?namespace&key` | 204; deletes its translations too |

Every change visitors could see clears the read service's in-memory snapshot; the frontend caches pick it up within 60 seconds.

## Route Pattern Syntax

Literal segments match exactly, `:name` matches one segment, and a final `*` matches one or more remaining segments (`/blog/*` covers `/blog/a` and `/blog/a/b`, not `/blog`). A trailing slash is ignored. `matchRoutePattern` in `@/types` is the single implementation the middleware, layout, switcher, sitemap, and admin counts share.

## Storage Schema

| Collection | Unique index | Fields |
|---|---|---|
| `module_localization_languages` | `code` | `code`, `name`, `nativeName`, `direction`, `enabled`, `createdAt`, `updatedAt` |
| `module_localization_routes` | `pattern` | `_id`, `pattern`, `languages[]`, `updatedAt` |
| `module_localization_keys` | `(namespace, key)` | `namespace`, `key`, `source`, `routes[]` (≤ 20, newest first), `origin`, `firstSeenAt`, `lastSeenAt`, `sourceChangedAt` |
| `module_localization_translations` | `(namespace, key, language)`; plus `language` | `namespace`, `key`, `language`, `text`, `updatedAt`, `updatedBy` |

A translation is *stale* when `translations.updatedAt < keys.sourceChangedAt`. Stale translations are still served.

## Source Map

| File | Purpose |
|---|---|
| `LocalizationModule.ts` | `IModule`: builds services in `init()`; publishes `'localization'`, mounts routers, registers menu nodes in `run()` |
| `services/localization.service.ts` | `LocalizationService` singleton (`ILocalizationService`); in-memory snapshot and catalogs, cleared by `invalidate()` |
| `services/localization-admin.service.ts` | Language, route, key, and translation management; all validation |
| `services/translation-observation.service.ts` | Intake of reported keys; missing-translation warnings |
| `services/translation-key-rules.ts` | Key pattern and length caps shared by both write paths |
| `api/isInternalServiceRequest.ts` | The frontend-container check guarding the observation route |
| `api/*.controller.ts`, `api/localization.routes.ts` | Thin HTTP adapters |
| `database/` | Document shapes, collection names, `ensureLocalizationIndexes` |

Bootstrap (`src/backend/index.ts`) injects `listKnownPaths` (CMS page slugs plus `main` menu URLs) for the enable check and `listKnownNamespaces` (`core` plus plugin manifest ids) for observation validation.

## Further Reading

- [frontend.md](../../../../docs/frontend/frontend.md#pages-live-under-the-lang-segment) — the `[lang]` route folder and the rule for rendering text through `t()`
- [plugins-frontend-context.md](../../../../docs/plugins/plugins-frontend-context.md) — `context.useTranslation()` for plugin pages and widgets
- [Widgets README](../widgets/README.md) — the `core:language-switcher` widget
