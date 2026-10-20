# Consent Module

Cookie consent for visitors in the EEA, the UK, and Switzerland. It owns the main switch, the rule deciding what each request may do, the banner settings, the Google Ads tag configuration, and a count of page views from visitors without analytics consent. Managed at `/system/consent`.

EU and UK cookie law requires opt-in consent before analytics or advertising cookies are set, and Google requires Consent Mode signals before its Ads tag may measure conversions for those visitors. Before this module existed, the `tronrelic_tid` analytics cookie was set on every visitor's first request. With the main switch off, the module changes nothing, which is how it shipped.

## Quick Reference

| | |
|---|---|
| Module id | `consent` |
| Module class | `src/backend/modules/consent/ConsentModule.ts` |
| Admin page | `/system/consent` (menu item `Consent`, order 43), tabs Settings, Database, Logs (Submenu Pattern, namespace `consent`) |
| Service registry | Publishes `'consent'` (`IConsentService` from `@/types`, constant `CONSENT_SERVICE_NAME`) in `run()` |
| Bootstrap | Initializes **before** the traffic module, which receives `getConsentService()` as its `consent` dependency |
| Public API | `GET /api/consent/config` → `IConsentPublicConfig` (`Cache-Control: public, max-age=60`); `POST /api/consent/pageviews` (rate limit 60 per minute per address) |
| Admin API (`requireAdmin`) | `GET`/`PATCH /api/admin/system/consent/settings`, `POST …/settings/renew`, `GET …/pageviews?days=` |
| Storage | `module_consent_settings` (one document keyed `settings`), `module_consent_pageview_daily` (one counter per UTC day) |
| Shared rules | `@/types` `consent/`: `resolveConsentState`, `isConsentRequiredCountry`, `CONSENT_REGION_COUNTRIES`, `parseConsentCookie`, `serializeConsentCookie`, `CONSENT_COOKIE_NAME`, `CONSENT_COOKIE_MAX_AGE_SECONDS` |
| Frontend module | `src/frontend/modules/consent/` (provider, banner, "Privacy choices" button, Google Ads tag, admin tab); server-only exports in `server.ts` |
| Log service | `tronrelic:consent` |
| Scheduler jobs | None |

## The Rule

`resolveConsentState(config, country, cookieValue)` in `@/types` is the only place the decision is made. The Next.js middleware, the root layout, the backend page-view endpoint, and the anonymous counter all call it, so they cannot disagree about one request.

| Situation | `required` | `analytics` | `ads` |
|---|---|---|---|
| Main switch off | false | true | false (tag never loads) |
| Outside the consent regions, no saved choice | false | true | true |
| Outside the consent regions, saved choice | false | the choice | the choice |
| Consent region or unknown country, no current choice | true | false | false |
| Consent region, current choice | true | the choice | the choice |

The consent regions are the EU, the rest of the EEA, the UK, and Switzerland, plus EU territories with their own country code (`CONSENT_REGION_COUNTRIES`). The list is fixed in code so a mistyped setting cannot drop a country. The country comes from Cloudflare's `cf-ipcountry` header. A missing header, `XX`, or `T1` (Tor) counts as a consent region, because showing one banner too many costs less than setting cookies on someone in the EU. In local development there is no header, so the banner shows whenever the switch is on.

A choice counts only when it was made under the current `policyVersion` and less than twelve months ago. "Ask everyone again" on the Settings tab raises the version.

## The Consent Cookie

`tronrelic_consent` holds `<version>.<analytics><ads>.<decidedAt>`, for example `3.10.1760000000`. The banner writes it in the browser so a choice applies without a reload. It is not `httpOnly`, lasts twelve months, and is strictly necessary, so it needs no consent of its own.

## What Each Part Does

| Part | Without analytics consent | With it |
|---|---|---|
| Middleware (`src/frontend/middleware.ts`) | Sets no `tronrelic_tid`, `tronrelic_ref`, or `_original_ref`, deletes any present, and does not read them. Still sends the server-side `bootstrap` row under a one-off id for full page loads only, so crawler data from EU locations is kept without anything stored in the visitor's browser | Unchanged |
| Page-view tracker (`PageViewTracker`) | Sends `POST /api/consent/pageviews` with only `{ automated }`; the per-tab referrer history is not touched | Sends the traffic beacon as before |
| Traffic `POST /api/user/track` | Records nothing and sets no cookie, even for an old browser bundle. A failed consent check also records nothing | Unchanged |
| Google Ads tag (`GoogleAdsTag`) | Not loaded | Loaded after hydration (Consent Mode "basic"), with `ad_personalization` denied because the site runs no remarketing. A click on any `a[rel~="sponsored"]` fires the configured conversion |

The middleware and the layout start from a fail-closed configuration when the backend cannot be reached: switched on with policy version 0, which no saved choice matches. Visitors outside the consent regions are unaffected; visitors inside one get the banner and no cookies until the real settings load.

Withdrawing a permission reloads the page. The middleware then deletes the analytics cookies, and the banner deletes the Google Ads cookies (`_gcl_*`, `_gac_*`) on the host and every parent domain before reloading, since the tag set them in the browser.

## Anonymous Page Views

Page views from visitors without analytics consent carry no identifier, so they cannot enter `traffic_events`, where every visitor and session figure is built from `candidate_uid`. Instead each adds one to `module_consent_pageview_daily` for the UTC day, after the public route checks that the request itself has no analytics consent (so a consenting visitor is never counted twice) and that the visitor is not on the traffic ignore list. Automated browsers are skipped. The Settings tab shows the last 30 days: that is how much traffic the `/system/traffic` dashboard does not see.

## Admin REST

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/admin/system/consent/settings` | — | `{ settings: IConsentSettings }` |
| PATCH | `/api/admin/system/consent/settings` | `{ enabled?, googleAdsId?, conversionLabel? }`; an empty string clears a field | `{ settings }`; 400 for an id not matching `GOOGLE_ADS_ID_PATTERN` (`AW-` and digits) or a label not matching `GOOGLE_ADS_CONVERSION_LABEL_PATTERN` |
| POST | `/api/admin/system/consent/settings/renew` | — | `{ settings }` with `policyVersion` raised by one |
| GET | `/api/admin/system/consent/pageviews` | `?days=` (default 30, 1–365) | `IConsentPageviewStats` |

Turning the main switch on or off and raising the policy version are logged as warnings, with the actor.

## Source Map

| Path | Responsibility |
|---|---|
| `ConsentModule.ts` | Two-phase lifecycle; publishes `'consent'`, mounts both routers, registers the menu entry and tabs |
| `services/consent.service.ts` | `ConsentService` singleton (`IConsentService`): settings storage and validation, the in-memory public config cleared on every save, `resolveRequest`, `renewConsent` |
| `services/anonymous-pageview.service.ts` | `AnonymousPageviewService`: daily counters and the windowed read |
| `api/consent-public.controller.ts`, `api/consent-admin.controller.ts`, `api/consent.routes.ts` | Public and admin handlers and routers |
| `database/` | Collection names, document shapes, and indexes |
| `__tests__/` | Module lifecycle, settings service, the shared rules in `@/types`, and the page-view counter |

## Related

- [Traffic README](../traffic/README.md) — the `tronrelic_tid` cookie and the page-view endpoint this module gates
- [system-runtime-config.md](../../../../docs/system/system-runtime-config.md) — how the frontend reads backend configuration
- [modules.md](../../../../docs/system/modules/modules.md) — the module lifecycle
