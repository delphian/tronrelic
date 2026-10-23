# Localization Module

Serves the site in languages other than English. Administrators add languages, publish routes in them one at a time, and store translations ahead of time; the frontend serves each translated page at its own `/<code>/...` address from memory, with no translation happening while a visitor waits. With no language enabled the module changes nothing: every URL stays English and every page renders exactly as before.

## Quick Reference

| | |
|---|---|
| Module id | `localization` |
| Service registry name | `'localization'` → `ILocalizationService` (read-only: snapshot, catalog, `translate`, `getLanguage`, `getLanguagesForPath`) |
| Admin UI | `/system/localization` — Languages, Routes, Translations, Switches, Settings, Database, Logs tabs |
| Public API | `/api/localization` |
| Admin API | `/api/admin/system/localization` (`requireAdmin`, grouped rate limiter) |
| Types | `@/types` → `packages/types/src/localization/` (contracts plus the shared helpers `matchRoutePattern`, `isValidRoutePattern`, `resolveLocalizedPath`, `findPublishedLanguages`, `localizePath`, `localizeHref`, `interpolateTranslation`, `DEFAULT_LANGUAGE`) |
| Frontend hooks | `useTranslation`, `useLocalization`, `useLocalizedHref` |
| Storage | `module_localization_languages`, `module_localization_routes`, `module_localization_keys`, `module_localization_translations`, `module_localization_settings`, `module_localization_switch_daily` |
| AI provider | Read per request from the core `'ai-providers'` registry (`IAiProviderRegistry`); the module works without one, and only the Suggest buttons need it |
| Frontend module | `src/frontend/modules/localization/` — `LocalizationProvider`, `useTranslation`, `LanguageSwitcher`, admin tabs; server-only helpers in `./server`, including `getServerTranslator` and `fetchLocalizationSeed` |
| Plugin API | `context.useTranslation()` and `context.useLocalizedHref()` on `IFrontendPluginContext`, and `ctx.translator` in a plugin page's server fetchers; keys scoped to the plugin id |
| Widget | `core:language-switcher` (widgets module catalog) |
| Log service | `tronrelic:localization` — missing-translation warnings land here |
| Menu | "Localization" under the System container; tab nodes in the `localization` namespace |

## How a Request Is Served

Every page lives under `src/frontend/app/[lang]/`. The Next.js middleware reads the public snapshot (cached 60 seconds, the same cache it keeps for the redirect map) and decides the language:

1. `/markets` is English. The middleware rewrites it internally to `/en/markets`; the address bar never changes.
2. `/zh/markets` is Chinese only when `zh` is enabled **and** a route covering `/markets` lists `zh`, whether published on the Routes tab or contributed by translated content such as a CMS page ([Content Routes](#content-routes)). Otherwise the whole path is treated as an English path, so it 404s, and a disabled language never takes over a page that already lives at `/zh/...`.
3. Public files (`/images/*.png`, `/plugins/*.js`, `/icon.png`) pass through untouched so Next.js can serve them.

The middleware sets the `x-tronrelic-language` request header to the language it chose and `x-pathname` to the path without the prefix. The `(site)` layout returns 404 for any request whose `[lang]` value the middleware did not set, which is what stops `/images/about` from rendering the `/about` page. The root layout fetches the snapshot and, for a non-English page, the catalog (both through the Next.js fetch cache), writes `<html lang dir>` and the `hreflang` links, and seeds `LocalizationProvider`. Components call `t(key, englishText)`; the same lookup runs on the server and in the browser, so hydration matches.

A language change is a change of the `[lang]` segment, so Next.js re-renders the root layout and the `<html lang>` attribute and surrounding chrome switch with it. The switcher uses plain links for the same reason.

## Rollout Workflow

1. **Languages tab** — add the language. It starts disabled; nothing changes for visitors.
2. **Translations tab** — keys appear as the site renders them. Pick the language and translate, narrowing the list by namespace, status, published route, or text. A key whose English changed after its translation was saved shows as *stale*. Each row shows the English above its editor; when two or more editors hold unsaved text, **Save all** in the panel header saves them in one request. The Suggest buttons fill editors from an AI model; see [AI Translation Suggestions](#ai-translation-suggestions).
3. **Routes tab** — publish the route pattern in the language. The missing count shows how many keys rendered on that route still lack a translation; "Show keys" opens the Translations tab filtered to them.
4. **Languages tab** — enable the language. Enabling is refused when existing CMS pages or menu URLs already start with `/<code>/`. The tab shows two sets of counts: **On published routes** covers the keys rendered on routes published in the language, the same keys the Routes tab counts; **All keys** covers every key the site has reported, including text seen only on pages not published in the language. A gap between the two is not an error. It is the work left before more routes can be published.
5. Place the **Language switcher** widget (`/system/widgets`) so visitors can reach the translated pages. It renders nothing on English-only pages.

A translated page that falls back to English for a missing key still renders; the frontend reports it and the backend logs a warning once per language and key per process (Logs tab).

## Switcher Click Tracking

The switcher's links cause a full page load, so in the traffic figures a visitor who chose Chinese looks the same as one who arrived at a `/zh/...` page from a search result. The switcher therefore reports each click itself. Clicking a language other than the current one calls `sendLanguageSwitch`, which posts `{ path, from, to, automated }` to `POST /api/localization/switches` through `sendJsonBeacon` (`navigator.sendBeacon`, falling back to a `keepalive` fetch), so the report survives the page unloading and never delays the link. A click on the current language is not a switch and is not sent.

`LanguageSwitchService` counts a click only when it is a real switch on that page. Both languages must be English or enabled, both must be published on a route covering the path, they must differ, and the browser must not report `navigator.webdriver`. A visitor on the traffic module's ignore list (`'traffic-ignore-list'`, resolved per request) is skipped. Every click gets a 204, counted or not, because the browser never reads the reply.

A counted click adds one to a counter keyed by UTC day, direction, and route pattern. It is stored against the published route pattern rather than the raw path, using the first covering route that lists the non-English language involved, so every key comes from a set an administrator controls and a caller cannot grow the collection by inventing paths or languages. The skips happen on arrival, so changing the ignore list later does not change counts already stored. The **Switches** tab reads them back as totals, a daily chart, and tables by direction and by route, over 7, 30, or 90 days.

## AI Translation Suggestions

Each row on the Translations tab has a Suggest button, and the panel header has **Suggest page**. Both send English text to an AI model and place its translations in the editors. **Nothing is saved**: the administrator reviews the text and saves the rows they accept.

| | |
|---|---|
| Per-row button | Translates that row, replacing whatever its editor holds |
| Suggest page | Translates every *missing* or *stale* row on the current page that has no unsaved text, in **one** request (at most `MAX_TRANSLATION_SUGGESTION_KEYS`, 50, the page size), so terms stay consistent across the batch |
| Settings tab | The system prompt (tone and glossary, such as "TRON is always 波场") and the provider and model. A null provider means the active one; a null model means the provider's default |
| Toast | The model's remarks on the batch, its per-key notes, keys it skipped, and the cost the provider reported (`costUsd`) with token counts. Stays open when there are notes |

`TranslationSuggestionService` resolves the provider through the `'ai-providers'` registry at request time: `getProvider(id)` when Settings names one, which fails with 503 rather than falling back if that provider is gone, otherwise `getActive()`. It calls `query()` with `toolAllowlist: []`, `expandVariables: false`, and `thinkingBudget: 0`, because the English comes from the site and plugins and must not be able to invoke a tool or expand a `{%variable%}`. The prompt (built in `translation-suggestion-prompt.ts`) sends the strings as JSON data with numbered ids, includes a stale row's previous translation as context, and asks for a JSON reply. The parser drops entries with unknown ids or empty text, reports their keys as unanswered, and adds a note when a translation dropped a `{placeholder}` the English has. Only an `end_turn` or `stop_sequence` stop is parsed; any other stop reason (`refusal`, `max_tokens`, `tool_use`, `pause_turn`) is reported as a 502, so an unfinished run never fills the editors. Every run is logged under `tronrelic:localization` with the actor, model, token usage, and cost.

Choosing the provider and accepting only a finished answer are shared with the core content translation Suggest button, in `src/backend/services/resolveAiProvider.ts` and `src/backend/services/runIsolatedAiQuery.ts`, and the toast body is the shared `SuggestionSummary` component. The two features keep separate settings, and both panels sit on the Settings tab: this module's for interface text, and core's **Content translation** panel for pages and every other content type.

The cost is the provider's figure after the run. There is no estimate beforehand, because `IAiProvider` has no pricing method and per-model rates live inside the provider plugin. The suggestion route has its own limit of 20 requests a minute on top of the admin limiter, since each one is a paid call.

## Translating Text in Code

Core components: `const { t } = useTranslation();` from `modules/localization` (namespace `core`). Plugins: `const { t } = context.useTranslation();` (namespace is the plugin id). Write the English text at the call site and keep the key stable when only the wording changes, so existing translations are flagged stale rather than lost:

```tsx
const { t } = context.useTranslation();
return <layout.PageHeader title={t('page.title', 'Energy Markets')} subtitle={t('page.count', '{count} markets', { count })} />;
```

Server code that cannot call a hook, chiefly a page's `generateMetadata`, uses `getServerTranslator(params)` from `modules/localization/server`. It returns the same translator, built from the same seed the root layout uses, and its `language` is the value to pass to `buildMetadata`, so a translated page sends search engines a translated title and description. The category landing branch of `generateMetadata` in `app/[lang]/(site)/[...slug]/page.tsx` is the working reference:

```tsx
const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);
return buildMetadata({ siteUrl, language, title: t('example.meta.title', 'Example Page'), path: '/example' });
```

A plugin page's `serverDataFetcher` and `serverMetadataFetcher` get that translator on `ctx.translator`, bound to the plugin's namespace. `buildServerDataContext` in `src/frontend/lib/` builds it for both routes that run them. A plugin page that is published in another language returns its title, description, and structured data from `serverMetadataFetcher`, because the static fields on its page config are never translated. See [plugins-seo-and-ssr.md](../../../../docs/plugins/plugins-seo-and-ssr.md#translating-metadata).

Pass values as `{name}` placeholders instead of concatenating, so a translator can move them. There is no plural support; use separate keys. Backend code producing visitor-facing text calls `serviceRegistry.get<ILocalizationService>('localization')?.translate(namespace, key, language, englishText, params)`.

**Links keep the visitor in their language.** Stored links, such as menu URLs, are unprefixed, so on a Chinese page a link to `/markets` would drop the visitor back into English. Prefixing every link is not safe either, because `/zh/x` returns 404 unless `x` is published in Chinese. `localizeHref(href, language, config)` in `@/types` applies the middleware's rule: it adds the prefix only when the target is live in the page's language, keeps any query string or fragment, and leaves English pages and off-site links alone. Client components call `const localize = useLocalizedHref()` and render `href={localize(url)}`, plugins call `context.useLocalizedHref()`, and server components build the same function from `fetchLocalizationSeed(lang)`. Menus (`MenuNavClient`) and category landing pages use it today. Other links across the site are still unprefixed and should adopt it as they are touched.

**Only text rendered on the server is reported.** Text that only appears after an interaction (a modal, a toast) is translated if a translation exists, but its key is not discovered automatically — add it on the Translations tab.

**Content is translated by the core content service, not here.** Page bodies, blog posts, and other managed content are content rather than interface text, so their translations are a capability of managed content: core keeps their state and runs their editor, and each content type stores its own translated text. Pages are translated from a page's **Translations** button on `/system/pages`; see [system-content.md](../../../../docs/system/system-content.md#translations). An item with a published translation into a language joins this module's snapshot automatically; see [Content Routes](#content-routes). Do not publish a CMS page's route on the Routes tab, and do not publish a broad pattern such as `/*` or `/:slug` that covers one: the snapshot merges every matching pattern's languages, so the middleware, switcher, `hreflang` links, and sitemap would advertise a language the page has no translation in, and requests in that language return 404 until it does.

## Content Routes

Bootstrap injects `listContentRoutes`, a function returning addresses other components publish in other languages on their own. It is the core content service's `translations().listLocalizedRoutes()`: every exact path a translatable content type serves an item at, such as a CMS page's slug and old slugs, for items with a published translation, with those translations' languages. `LocalizationService` merges them with the Routes tab's routes by pattern, filters both to enabled languages, and serves the result as one snapshot, so the middleware, `hreflang` links, sitemap, language switcher, and `localizeHref` treat a translated page like a published route. The Routes tab and its counts show only the routes administrators published there.

The core content service calls `LocalizationService.invalidate()` after a translation change, and the pages module after a page change that can alter what is served, each through a closure bootstrap gives it. Because an approval from the curation queue can finish after it asks for the rebuild, a snapshot that includes content routes is also rebuilt once it is 60 seconds old. A failure in the source is logged as a warning and the snapshot is built without content routes, so the published routes keep working; the next rebuild retries.

## Public REST

| Method | Path | Notes |
|---|---|---|
| GET | `/api/localization/config` | `ILocalizationPublicConfig`: enabled languages and routes with their enabled languages only. `Cache-Control: public, max-age=60` |
| GET | `/api/localization/catalog/:language` | `ITranslationCatalog`. Empty for `en`. Same cache header |
| POST | `/api/localization/observations` | `{ observations: ITranslationObservation[] }` → 204. **Frontend container only**: refused (403) when any proxy header (`x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, `forwarded`) is present or the peer is not a private address. Rate-limited 600/min |
| POST | `/api/localization/switches` | `ILanguageSwitch` → 204 whether or not it was counted. Public, from visitors' browsers. Rate-limited 30/min per address. See [Switcher Click Tracking](#switcher-click-tracking) |

Observations are validated: the namespace must be `core` or a discovered plugin id, keys match `^[A-Za-z0-9_.:-]{1,200}$`, sources are capped at 2,000 characters, batches at 200, and the collection at 20,000 keys.

**How a key is tied to a route.** The admin counts attribute a key to a route only when one of the key's remembered paths (`routes[]`) matches the route's pattern, so both caps on those paths protect published routes. The frontend (`observationReporter.ts`) reports each key with at most five paths per server process, except that a path covered by a published route the key has not yet been reported on is always reported, once per route per process. The backend keeps at most 20 paths per key; when a new path overflows the list, `selectRoutesToDrop` drops the oldest paths first but keeps the newest path matching each published pattern, so header and menu keys seen on thousands of address pages stay attributed to every published route. The frontend only knows routes published in an *enabled* language, so for a language that is still disabled the five-path cap applies as before; visit the route once after enabling the language if its counts look short.

## Admin REST

All under `/api/admin/system/localization`. Errors: 400 validation, 404 not found, 409 conflict, 502 unusable AI reply, 503 no AI provider, each with `{ error }`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/languages` | — | `{ languages: ILanguageSummary[] }` with site-wide translated/stale/missing counts and the same counts over published routes in `publishedRoutes` (`ITranslationProgress`) |
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
| PUT | `/translations/batch` | `{ language, translations: [{ namespace, key, text }] }` (1–200) | `{ translations }`; every entry is checked before any is written, so one bad entry saves nothing. Backs **Save all**, which would otherwise spend one admin rate-limit slot per row |
| DELETE | `/translations` | `?namespace&key&language` | 204 |
| POST | `/keys` | `{ namespace, key, source }` | `{ key }` 201, `origin: 'manual'` |
| DELETE | `/keys` | `?namespace&key` | 204; deletes its translations too |
| GET | `/settings` | — | `{ settings: ILocalizationSettings }`, with the default system prompt before the first save |
| PATCH | `/settings` | `{ systemPrompt?, providerId?, model? }` | `{ settings }`; changing `providerId` without `model` clears the model |
| GET | `/switches` | `days` (default 30, clamped 1–365) | `ILanguageSwitchStats`: `total`, `byDay` (every day in the window, zero-filled), `byPair` and `byRoute` (most used first), `windowStart`/`windowEnd` |
| POST | `/translation-suggestions` | `{ language, keys: [{ namespace, key }] }` (1–50 keys) | `ITranslationSuggestionResult`; saves nothing. Limited to 20 a minute |

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
| `module_localization_settings` | `key` (always `'settings'`) | `key`, `systemPrompt`, `providerId`, `model`, `updatedAt`, `updatedBy` |
| `module_localization_switch_daily` | `(day, from, to, pattern)` | `day` (UTC `YYYY-MM-DD`), `from`, `to`, `pattern`, `count` |

A translation is *stale* when `translations.updatedAt < keys.sourceChangedAt`. Stale translations are still served.

## Source Map

| File | Purpose |
|---|---|
| `LocalizationModule.ts` | `IModule`: builds services in `init()`; publishes `'localization'`, mounts routers, registers menu nodes in `run()` |
| `services/localization.service.ts` | `LocalizationService` singleton (`ILocalizationService`); in-memory snapshot and catalogs, cleared by `invalidate()` |
| `services/localization-admin.service.ts` | Language, route, key, and translation management; all validation |
| `services/translation-observation.service.ts` | Intake of reported keys; missing-translation warnings; `selectRoutesToDrop`, which trims a key's path list without losing its published routes |
| `services/translation-key-rules.ts` | Key pattern and length caps shared by both write paths |
| `services/localization-settings.service.ts` | The settings document: system prompt, provider, model, and the default prompt |
| `services/translation-suggestion.service.ts` | Resolves the AI provider, runs the translation request, logs usage and cost |
| `services/translation-suggestion-prompt.ts` | Pure prompt builder and reply parser |
| `services/language-switch.service.ts` | Validates switcher clicks against the public snapshot, increments the daily counters, folds them into `ILanguageSwitchStats` |
| `api/isInternalServiceRequest.ts` | The frontend-container check guarding the observation route |
| `api/*.controller.ts`, `api/localization.routes.ts` | Thin HTTP adapters |
| `database/` | Document shapes, collection names, `ensureLocalizationIndexes` |

Bootstrap (`src/backend/index.ts`) injects `listKnownPaths` (CMS page slugs plus `main` menu URLs) for the enable check, `listKnownNamespaces` (`core` plus plugin manifest ids) for observation validation, and `listContentRoutes` (translated content addresses from the core content service) for the snapshot.

## Further Reading

- [frontend.md](../../../../docs/frontend/frontend.md#pages-live-under-the-lang-segment) — the `[lang]` route folder and the rule for rendering text through `t()`
- [plugins-frontend-context.md](../../../../docs/plugins/plugins-frontend-context.md) — `context.useTranslation()` for plugin pages and widgets
- [Widgets README](../widgets/README.md) — the `core:language-switcher` widget
