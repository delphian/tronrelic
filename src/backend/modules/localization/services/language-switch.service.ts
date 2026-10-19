/**
 * @fileoverview Counts language switcher clicks and reports them to the admin page.
 *
 * The switcher's links cause a full page load, so the only record of a visitor
 * choosing another language used to be two unrelated page views. This service
 * stores the choice itself: one counter per UTC day, direction (`en → zh`), and
 * published route pattern, read back on the Switches tab of
 * `/system/localization`.
 *
 * Clicks arrive on a public endpoint, so every field is treated as untrusted.
 * A click is counted only when both languages are live on the page it came
 * from, and it is stored against the route pattern that publishes the page
 * rather than the raw path. Both rules keep the counter keys inside sets an
 * administrator controls, so a caller cannot invent languages or paths to grow
 * the collection.
 */

import type {
    IDatabaseService,
    ILanguageSwitch,
    ILanguageSwitchDay,
    ILanguageSwitchPair,
    ILanguageSwitchRoute,
    ILanguageSwitchStats,
    ILocalizationPublicConfig,
    ILocalizationService
} from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODE_PATTERN, matchRoutePattern } from '@/types';
import type { ILanguageSwitchDailyDocument } from '../database/index.js';
import { SWITCH_DAILY_COLLECTION } from '../database/index.js';
import { MAX_PATH_LENGTH } from './translation-key-rules.js';

/** Window the stats read uses when the caller does not name one. */
export const DEFAULT_SWITCH_STATS_DAYS = 30;

/** Longest window the stats read accepts, matching the widest picker on other admin pages. */
export const MAX_SWITCH_STATS_DAYS = 365;

/** Milliseconds in one day, for stepping back through the window. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Collaborators the switch service needs. */
export interface ILanguageSwitchServiceDependencies {
    /** Core database service holding the daily counters. */
    database: IDatabaseService;
    /**
     * The module's read service. Its public snapshot decides which languages
     * are live and which route pattern publishes a path, the same answer the
     * middleware and the switcher itself use.
     */
    localization: Pick<ILocalizationService, 'getPublicConfig'>;
}

/**
 * Format a moment as the UTC day the counters are keyed by.
 *
 * @param date - Any moment.
 * @returns The UTC day as `YYYY-MM-DD`.
 */
function toDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * Validates switcher clicks, stores them as daily counters, and summarises
 * them for the admin page.
 */
export class LanguageSwitchService {
    private readonly database: IDatabaseService;
    private readonly localization: Pick<ILocalizationService, 'getPublicConfig'>;

    /**
     * @param deps - Collaborators wired by the module.
     */
    constructor(deps: ILanguageSwitchServiceDependencies) {
        this.database = deps.database;
        this.localization = deps.localization;
    }

    /**
     * Count one switcher click, if it describes a real switch.
     *
     * A click is dropped when it is malformed, when it does not change
     * language, when the browser reports automation, or when either language
     * is not live on the page it came from. Dropping is silent because the
     * browser sends and forgets; the return value exists for the controller's
     * logging and for tests.
     *
     * @param raw - The untrusted request body.
     * @param now - When the click arrived, injectable so tests can pin the day.
     * @returns True when the click was counted.
     */
    async record(raw: unknown, now: Date = new Date()): Promise<boolean> {
        const click = this.parse(raw);
        let counted = false;
        if (click) {
            const pattern = this.resolvePattern(await this.localization.getPublicConfig(), click);
            if (pattern) {
                await this.increment({ day: toDayKey(now), from: click.from, to: click.to, pattern });
                counted = true;
            }
        }
        return counted;
    }

    /**
     * Summarise the switches recorded in a trailing window of whole UTC days.
     *
     * The counters for a window are few — at most one per day, direction, and
     * route — so they are read in one query and folded here rather than with
     * an aggregation pipeline.
     *
     * @param days - Window length in days, today included. Clamped to
     *   1–`MAX_SWITCH_STATS_DAYS`; anything that is not a number uses the default.
     * @param now - The moment the window ends at, injectable for tests.
     * @returns Totals by day, by direction, and by route.
     */
    async getStats(days: number, now: Date = new Date()): Promise<ILanguageSwitchStats> {
        const windowDays = Number.isFinite(days)
            ? Math.min(MAX_SWITCH_STATS_DAYS, Math.max(1, Math.floor(days)))
            : DEFAULT_SWITCH_STATS_DAYS;
        const dayKeys: string[] = [];
        for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
            dayKeys.push(toDayKey(new Date(now.getTime() - offset * DAY_MS)));
        }
        const windowStart = dayKeys[0];
        const windowEnd = dayKeys[dayKeys.length - 1];

        const documents = await this.counters()
            .find({ day: { $gte: windowStart, $lte: windowEnd } })
            .toArray();

        const perDay = new Map<string, number>(dayKeys.map(day => [day, 0]));
        const perPair = new Map<string, ILanguageSwitchPair>();
        const perRoute = new Map<string, number>();
        let total = 0;

        for (const document of documents) {
            total += document.count;
            perDay.set(document.day, (perDay.get(document.day) ?? 0) + document.count);
            const pairKey = `${document.from}\u0000${document.to}`;
            const pair = perPair.get(pairKey) ?? { from: document.from, to: document.to, count: 0 };
            pair.count += document.count;
            perPair.set(pairKey, pair);
            perRoute.set(document.pattern, (perRoute.get(document.pattern) ?? 0) + document.count);
        }

        const byDay: ILanguageSwitchDay[] = dayKeys.map(day => ({ day, count: perDay.get(day) ?? 0 }));
        const byPair = [...perPair.values()].sort((a, b) => b.count - a.count);
        const byRoute: ILanguageSwitchRoute[] = [...perRoute.entries()]
            .map(([pattern, count]) => ({ pattern, count }))
            .sort((a, b) => b.count - a.count);

        return { days: windowDays, windowStart, windowEnd, total, byDay, byPair, byRoute };
    }

    /**
     * Validate an untrusted click body.
     *
     * The path loses any query string or fragment and is length-capped, the
     * same treatment translation observations get, so a stray `?utm=` cannot
     * stop the path matching its route pattern.
     *
     * @param raw - The request body as received.
     * @returns The click, or null when it is unusable or not a real switch.
     */
    private parse(raw: unknown): ILanguageSwitch | null {
        let click: ILanguageSwitch | null = null;
        if (typeof raw === 'object' && raw !== null) {
            const candidate = raw as Record<string, unknown>;
            const { path, from, to } = candidate;
            const valid = typeof path === 'string' && path.startsWith('/')
                && typeof from === 'string' && LANGUAGE_CODE_PATTERN.test(from)
                && typeof to === 'string' && LANGUAGE_CODE_PATTERN.test(to)
                && from !== to
                && candidate.automated !== true;
            if (valid) {
                click = {
                    path: (path as string).split(/[?#]/)[0].slice(0, MAX_PATH_LENGTH),
                    from: from as string,
                    to: to as string
                };
            }
        }
        return click;
    }

    /**
     * Find the published route pattern a click is counted against.
     *
     * Both languages must be live on the page: English always is, and any
     * other language must be enabled and published on a route covering the
     * path. The pattern returned is the first covering route that lists the
     * non-English language the click involves — the destination, or the
     * origin when the visitor went back to English — so the count lands on the
     * route that made the switch possible.
     *
     * @param config - The public snapshot of enabled languages and routes.
     * @param click - A validated click.
     * @returns The route pattern, or null when the click is not a valid switch on that page.
     */
    private resolvePattern(config: ILocalizationPublicConfig, click: ILanguageSwitch): string | null {
        const covering = config.routes.filter(route => matchRoutePattern(route.pattern, click.path));
        const published = new Set([DEFAULT_LANGUAGE, ...covering.flatMap(route => route.languages)]);
        const enabled = new Set([DEFAULT_LANGUAGE, ...config.languages.map(language => language.code)]);
        /**
         * Whether a visitor can actually read this page in a language, which
         * is what makes a click towards or away from it a real switch.
         *
         * @param code - Language code from the click.
         * @returns True when the language is enabled and published on the page.
         */
        const live = (code: string): boolean => enabled.has(code) && published.has(code);
        const anchor = click.to !== DEFAULT_LANGUAGE ? click.to : click.from;

        let pattern: string | null = null;
        if (live(click.from) && live(click.to)) {
            pattern = covering.find(route => route.languages.includes(anchor))?.pattern ?? null;
        }
        return pattern;
    }

    /**
     * Add one to a day's counter, creating it on the first click.
     *
     * Two clicks arriving together on a new counter can both try to create
     * it. The unique index rejects the second with a duplicate-key error,
     * which means the counter now exists, so the increment is repeated
     * without the upsert.
     *
     * @param key - Day, direction, and route pattern of the counter.
     * @returns Resolves once the increment is stored.
     */
    private async increment(key: Omit<ILanguageSwitchDailyDocument, 'count'>): Promise<void> {
        try {
            await this.counters().updateOne(key, { $inc: { count: 1 } }, { upsert: true });
        } catch (error) {
            if ((error as { code?: number }).code !== 11000) {
                throw error;
            }
            await this.counters().updateOne(key, { $inc: { count: 1 } });
        }
    }

    /**
     * The daily counter collection, typed.
     *
     * @returns The raw collection handle.
     */
    private counters() {
        return this.database.getCollection<ILanguageSwitchDailyDocument>(SWITCH_DAILY_COLLECTION);
    }
}
