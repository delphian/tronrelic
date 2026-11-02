/**
 * @fileoverview AI tool registration for the localization module.
 *
 * Exposes one read-only tool, `localization-get-status`, so an AI agent can
 * answer "how are our languages doing" — which languages exist and are live,
 * how much of each is translated, which routes are published and what is
 * still missing on them, how often visitors use the language switcher, and
 * which keys are left to translate — without an operator opening
 * `/system/localization` or querying the database by hand.
 *
 * Every view reads through the same service methods the admin page's tabs
 * use, so the tool and the page cannot disagree about a figure. The tool never
 * writes; saving a translation or publishing a route stays an admin action.
 *
 * It registers on the core `'ai-tools'` registry through `watch()`, because
 * the ai-tools module publishes the registry in its own `run()` and bootstrap
 * order does not guarantee that has happened when this module runs.
 */

import type {
    IAiTool,
    IAiToolRegistry,
    ILanguageSummary,
    ILanguageSwitchStats,
    ILocalizationPublicConfig,
    ILocalizedRouteSummary,
    IServiceRegistry,
    ISystemLogService,
    ITranslationPage,
    ServiceWatchDisposer,
    TranslationStatus
} from '@/types';
import { LANGUAGE_CODE_PATTERN, PLUGIN_ID_PATTERN, isValidRoutePattern } from '@/types';
import type { ITranslationListQuery } from './services/localization-admin.service.js';
import { CORE_NAMESPACE } from './services/translation-key-rules.js';

/** Provider id passed to `registerTool`, so the admin UI groups the tool under this module. */
export const PROVIDER_ID = 'localization';

/**
 * Tool names, spelled once. The `localization-` prefix names the owning
 * module, as the AI tool standard requires.
 */
export const AI_TOOL_NAMES = {
    status: 'localization-get-status'
} as const;

/**
 * Registry name of the core AI tool registry. Written out rather than imported
 * from the ai-tools module, whose barrel would load that whole module into
 * this one; the same reason `LocalizationModule` spells out `'ai-providers'`.
 */
const AI_TOOLS_SERVICE_NAME = 'ai-tools';

/** Views the tool can return. */
const VIEWS = ['languages', 'routes', 'switches', 'keys'] as const;

/** View used when the model omits `view`. */
const DEFAULT_VIEW = 'languages';

/** Translation states the `keys` view can filter to. */
const KEY_STATUSES: readonly TranslationStatus[] = ['missing', 'stale', 'translated'];

/** Most rows one call returns, protecting the model's context window. */
const MAX_ROWS = 50;

/** Rows returned when the model omits `limit`. */
const DEFAULT_ROWS = 20;

/**
 * Deepest offset the `keys` view accepts. The key collection is capped at
 * 20,000 entries by observation intake, so nothing lies beyond this.
 */
const MAX_OFFSET = 20000;

/**
 * Widest switch-statistics window, in days. Matches the widest preset the
 * traffic tools offer, so a model comparing the two reads the same span.
 */
const MAX_SWITCH_DAYS = 90;

/** Switch-statistics window used when the model omits `days`. */
const DEFAULT_SWITCH_DAYS = 30;

/**
 * Longest English source or translation text returned per key. Sources may be
 * up to 4,000 characters, so fifty untrimmed rows could fill a context window
 * by themselves. The full text stays on the Translations tab.
 */
const MAX_TEXT_LENGTH = 300;

/** Longest route pattern the `route` filter accepts. */
const MAX_ROUTE_LENGTH = 200;

/**
 * The reads the tool depends on. Declared as a narrow interface rather than
 * the concrete services, so the tool depends only on what it calls and tests
 * can supply plain stubs.
 */
export interface ILocalizationToolReads {
    /** Languages with site-wide and published-route translation progress (the Languages tab). */
    listLanguages(): Promise<ILanguageSummary[]>;
    /** Routes published on the Routes tab with their missing-key counts. */
    listRoutes(): Promise<ILocalizedRouteSummary[]>;
    /** One filtered page of keys and their translation in one language (the Translations tab). */
    listTranslations(query: ITranslationListQuery): Promise<ITranslationPage>;
    /** Language switcher usage over a trailing window of days (the Switches tab). */
    getSwitchStats(days: number): Promise<ILanguageSwitchStats>;
    /** The public snapshot: enabled languages and every route served in them, translated CMS pages included. */
    getPublicConfig(): Promise<ILocalizationPublicConfig>;
}

/**
 * Clamp a `limit` argument into the safe row range.
 *
 * Enforced here rather than left to the schema's `maximum`, because the schema
 * is a hint to the model and a request for "all of them" would otherwise pull
 * a large result into the context window.
 *
 * @param value - Raw `limit` input.
 * @returns A row count within `[1, MAX_ROWS]`.
 */
function resolveLimit(value: unknown): number {
    const requested = Number(value);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_ROWS;
    return Math.min(limit, MAX_ROWS);
}

/**
 * Read an `offset` argument, rejecting anything outside the valid range.
 *
 * A malformed offset is rejected rather than reset to zero, because a model
 * that asked for page three and silently received page one would report
 * repeated rows as new findings.
 *
 * @param value - Raw `offset` input; absent means zero.
 * @returns The offset to skip.
 */
function resolveOffset(value: unknown): number {
    const offset = value === undefined || value === null ? 0 : Number(value);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
        throw new Error(`Parameter "offset" must be a whole number from 0 to ${MAX_OFFSET}. Got: ${String(value)}`);
    }
    return offset;
}

/**
 * Read an optional string argument from a closed set.
 *
 * @param value - Raw argument from the model.
 * @param allowed - Values the argument may take.
 * @param name - Argument name, used in the error message.
 * @returns The validated value, or undefined when the argument is absent.
 */
function resolveEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T | undefined {
    let resolved: T | undefined;
    if (value !== undefined && value !== null && value !== '') {
        const text = String(value);
        if (!(allowed as readonly string[]).includes(text)) {
            throw new Error(`Parameter "${name}" must be one of: ${allowed.join(', ')}. Got: ${text}`);
        }
        resolved = text as T;
    }
    return resolved;
}

/**
 * Shorten a text to {@link MAX_TEXT_LENGTH} characters and say whether it was.
 *
 * Reporting the cut lets the model tell the operator a string continues
 * rather than quoting a fragment as the whole text.
 *
 * @param text - Source or translation text.
 * @returns The possibly shortened text and whether it was shortened.
 */
function clip(text: string): { text: string; truncated: boolean } {
    const truncated = text.length > MAX_TEXT_LENGTH;
    return { text: truncated ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text, truncated };
}

/**
 * Build the `localization-get-status` tool bound to the given reads.
 *
 * @param reads - The admin and read-side service methods the views call.
 * @returns The tool definition, ready for `registerTool`.
 */
export function buildLocalizationStatusTool(reads: ILocalizationToolReads): IAiTool {
    return {
        name: AI_TOOL_NAMES.status,
        description:
            'Report how TronRelic\'s site translations are doing — the figures behind the Languages, Routes, ' +
            'Switches, and Translations tabs of /system/localization. English is the default language and is never ' +
            'listed. Views: ' +
            '"languages" (the default): every configured language with its English and native name, whether it is ' +
            'enabled for visitors, how many routes are served in it (servedRoutes, which includes CMS pages with a ' +
            'published translation), and translation progress as translated/stale/missing key counts twice over — ' +
            '`siteWide` covers every key the site has rendered, `publishedRoutes` covers only keys rendered on ' +
            'routes published in that language, which are the gaps a visitor can actually see. A gap between the ' +
            'two is work left before more routes can be published, not an error. ' +
            '"routes": each route published on the Routes tab with its languages, how many keys render on it ' +
            '(keyCount), and how many of those lack a translation per language (missingByLanguage). Translated CMS ' +
            'pages are served without a Routes-tab entry, so they appear in servedRoutes but not here. ' +
            '"switches": language switcher clicks over the last `days` days (default ' + DEFAULT_SWITCH_DAYS + ', ' +
            'at most ' + MAX_SWITCH_DAYS + '), as a total, a zero-filled daily series, and by direction and route. ' +
            'Only real switches on pages published in both languages are counted; ignored accounts and automated ' +
            'browsers are excluded. ' +
            '"keys": one page of keys for ONE `language` (required), with the English source, the translation if ' +
            'any, and status ("missing", "stale" = the English changed after the translation was saved, or ' +
            '"translated"). Filter with `status`, `route` (a route pattern such as "/resource-markets/*"), and ' +
            '`namespace` ("core" or a plugin id). Texts longer than ' + MAX_TEXT_LENGTH + ' characters are cut and ' +
            'flagged truncated. Page with `limit`/`offset` while hasMore is true; `total` counts every match. ' +
            'Use "languages" first for any "how are our languages doing" question, then "routes" or "keys" to ' +
            'explain a gap. For how many people READ the translated pages, use tronrelic-query-traffic-breakdown ' +
            'with dimension "pages" and a pathPrefix such as "/zh" — this tool counts translations, not visitors. ' +
            'This tool is read-only and cannot save translations, publish routes, or enable languages.',
        // Capability: read / internal / surfaces-untrusted. Every figure is a
        // count this module computed, and languages and routes are written by
        // admins. The keys view is the reason for the untrusted declaration: a
        // key's English source is whatever text a component passed to t(), and
        // plugins pass data-derived labels such as third-party market names,
        // so a source can carry text from outside the platform. Declared so
        // the governor wraps and screens the result. Each key's reported path
        // list is never returned, because those paths come from visitor URLs.
        capability: { sideEffect: 'read', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true },
        inputSchema: {
            type: 'object',
            description: 'View, filter, and paging options for the localization status read',
            properties: {
                view: {
                    type: 'string',
                    enum: [...VIEWS],
                    description: `Which view to return. Defaults to "${DEFAULT_VIEW}".`
                },
                language: {
                    type: 'string',
                    description: 'Required for view "keys"; rejected by the others. A configured language code such as "zh" or "vi".'
                },
                status: {
                    type: 'string',
                    enum: [...KEY_STATUSES],
                    description: 'Only for view "keys". Keep keys in one translation state.'
                },
                route: {
                    type: 'string',
                    maxLength: MAX_ROUTE_LENGTH,
                    description: 'Only for view "keys". Keep keys rendered on a path this route pattern matches, such as "/resource-markets/*".'
                },
                namespace: {
                    type: 'string',
                    description: 'Only for view "keys". Keep keys owned by "core" or by one plugin id, such as "resource-markets".'
                },
                days: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_SWITCH_DAYS,
                    description: `Only for view "switches". Window length in days, today included. Defaults to ${DEFAULT_SWITCH_DAYS}.`
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_ROWS,
                    description: `Only for views "routes" and "keys". Max rows to return. Defaults to ${DEFAULT_ROWS}, capped at ${MAX_ROWS}.`
                },
                offset: {
                    type: 'integer',
                    minimum: 0,
                    maximum: MAX_OFFSET,
                    description: 'Only for views "routes" and "keys". Rows to skip; advance it by `limit` while hasMore is true.'
                }
            },
            required: [],
            additionalProperties: false
        },
        inputExamples: [
            {},
            { view: 'routes' },
            { view: 'switches', days: 7 },
            { view: 'keys', language: 'zh', status: 'missing', limit: 50 },
            { view: 'keys', language: 'vi', route: '/resource-markets/*', status: 'stale' }
        ],
        handler: async (input) => {
            const view = resolveEnum(input.view, VIEWS, 'view') ?? DEFAULT_VIEW;

            // Rejected rather than ignored on the views that would not use
            // them, so a model that asked for "zh languages" learns the list
            // was not filtered instead of narrating every language as Chinese.
            const keyOnly = ['language', 'status', 'route', 'namespace'].filter(name => input[name] !== undefined);
            if (view !== 'keys' && keyOnly.length > 0) {
                throw new Error(`Parameter(s) ${keyOnly.map(name => `"${name}"`).join(', ')} apply only to view "keys".`);
            }
            if (view !== 'switches' && input.days !== undefined) {
                throw new Error('Parameter "days" applies only to view "switches".');
            }

            let result: Record<string, unknown>;
            if (view === 'languages') {
                const [languages, config] = await Promise.all([reads.listLanguages(), reads.getPublicConfig()]);
                result = {
                    view,
                    languages: languages.map(language => ({
                        code: language.code,
                        name: language.name,
                        nativeName: language.nativeName,
                        direction: language.direction,
                        enabled: language.enabled,
                        // Only whether guidance exists: the prompt text itself is
                        // operator instructions for the Suggest buttons and can run
                        // to 4,000 characters.
                        hasTranslationPrompt: language.translationPrompt.trim().length > 0,
                        servedRoutes: config.routes.filter(route => route.languages.includes(language.code)).length,
                        siteWide: { translated: language.translated, stale: language.stale, missing: language.missing },
                        publishedRoutes: language.publishedRoutes,
                        createdAt: language.createdAt,
                        updatedAt: language.updatedAt
                    }))
                };
            } else if (view === 'routes') {
                const limit = resolveLimit(input.limit);
                const offset = resolveOffset(input.offset);
                const routes = await reads.listRoutes();
                const page = routes.slice(offset, offset + limit);
                result = {
                    view,
                    scope: 'routes published on the Routes tab; translated CMS pages are served without one',
                    total: routes.length,
                    limit,
                    offset,
                    returned: page.length,
                    hasMore: offset + page.length < routes.length,
                    routes: page.map(route => ({
                        pattern: route.pattern,
                        languages: route.languages,
                        keyCount: route.keyCount,
                        missingByLanguage: route.missingByLanguage,
                        updatedAt: route.updatedAt
                    }))
                };
            } else if (view === 'switches') {
                const requested = input.days === undefined ? DEFAULT_SWITCH_DAYS : Number(input.days);
                if (!Number.isInteger(requested) || requested < 1 || requested > MAX_SWITCH_DAYS) {
                    throw new Error(`Parameter "days" must be a whole number from 1 to ${MAX_SWITCH_DAYS}. Got: ${String(input.days)}`);
                }
                result = { view, ...(await reads.getSwitchStats(requested)) };
            } else {
                const language = typeof input.language === 'string' ? input.language.trim() : '';
                if (!LANGUAGE_CODE_PATTERN.test(language)) {
                    throw new Error('View "keys" requires "language", a configured language code such as "zh". Call view "languages" to list them.');
                }
                const status = resolveEnum(input.status, KEY_STATUSES, 'status');
                const route = input.route === undefined ? undefined : String(input.route);
                if (route !== undefined && (route.length > MAX_ROUTE_LENGTH || !isValidRoutePattern(route))) {
                    throw new Error(
                        'Parameter "route" must be a route pattern such as "/about", "/blog/:slug", or "/blog/*". ' +
                        'Call view "routes" to list published patterns.'
                    );
                }
                const namespace = input.namespace === undefined ? undefined : String(input.namespace);
                if (namespace !== undefined && namespace !== CORE_NAMESPACE && !PLUGIN_ID_PATTERN.test(namespace)) {
                    throw new Error(`Parameter "namespace" must be "${CORE_NAMESPACE}" or a plugin id such as "resource-markets".`);
                }
                const limit = resolveLimit(input.limit);
                const offset = resolveOffset(input.offset);

                const page = await reads.listTranslations({ language, status, route, namespace, limit, offset });
                result = {
                    view,
                    language,
                    filter: { status: status ?? null, route: route ?? null, namespace: namespace ?? null },
                    total: page.total,
                    limit,
                    offset,
                    returned: page.rows.length,
                    hasMore: offset + page.rows.length < page.total,
                    keys: page.rows.map(row => {
                        const source = clip(row.source);
                        const translation = row.translation ? clip(row.translation.text) : null;
                        return {
                            namespace: row.namespace,
                            key: row.key,
                            status: row.status,
                            source: source.text,
                            sourceTruncated: source.truncated,
                            translation: translation?.text ?? null,
                            translationTruncated: translation?.truncated ?? false,
                            translationUpdatedAt: row.translation?.updatedAt ?? null,
                            sourceChangedAt: row.sourceChangedAt
                        };
                    })
                };
            }
            return result;
        }
    };
}

/**
 * Watch the service registry for the core `'ai-tools'` registry and register
 * the localization tool whenever it becomes available.
 *
 * The tool is unregistered before each registration so a re-published
 * registry never trips the duplicate-name guard. Failures are logged and
 * swallowed: the tool is optional, and this module decides the language of
 * every page render, so it must never fail because of it.
 *
 * @param serviceRegistry - Shared service registry to watch.
 * @param reads - The service methods the tool's views call.
 * @param logger - Module-scoped logger for registration telemetry.
 * @returns Disposer that removes the watch subscription.
 */
export function registerLocalizationAiTools(
    serviceRegistry: IServiceRegistry,
    reads: ILocalizationToolReads,
    logger: ISystemLogService
): ServiceWatchDisposer {
    const tool = buildLocalizationStatusTool(reads);

    return serviceRegistry.watch<IAiToolRegistry>(AI_TOOLS_SERVICE_NAME, {
        onAvailable: (registry) => {
            try {
                registry.unregisterTool(tool.name);
                registry.registerTool(tool, PROVIDER_ID);
                logger.info({ tools: [tool.name] }, 'Registered localization AI tools with the core ai-tools registry');
            } catch (error) {
                logger.error({ error }, 'Failed to register localization AI tools with the core ai-tools registry');
            }
        }
    });
}
