/**
 * @fileoverview Intake for the keys the frontend server reports rendering.
 *
 * Translators need a list of what to translate, and the only complete list is
 * the one the running site produces: every `t(key, englishText)` call the
 * frontend renders on the server is reported here once per frontend process.
 * This service stores each key with its English text and the paths it was
 * seen on, and logs a warning the first time a translated page fell back to
 * English for a key. That warning is the "missing translation" signal the
 * module's Logs tab shows.
 *
 * Reports arrive over HTTP, so every field is treated as untrusted: the
 * namespace must belong to core or a known plugin, the key and text are
 * length-capped, and the total number of keys is capped so a flood of junk
 * cannot grow the collection without bound.
 */

import type { IDatabaseService, ISystemLogService, ITranslationObservation } from '@/types';
import { LANGUAGE_CODE_PATTERN } from '@/types';
import type { ITranslationKeyDocument } from '../database/index.js';
import { KEYS_COLLECTION } from '../database/index.js';
import { KEY_PATTERN, MAX_PATH_LENGTH, MAX_ROUTES_PER_KEY, MAX_SOURCE_LENGTH, joinKeyId } from './translation-key-rules.js';

/** Most observations accepted in one request; the frontend batches well below this. */
export const MAX_OBSERVATIONS_PER_BATCH = 200;

/**
 * Most keys the collection will hold. Far above what the site renders today,
 * and low enough that the in-memory joins on the admin page stay quick.
 */
const MAX_KEYS = 20000;

/** Most distinct missing-translation warnings remembered per process. */
const MAX_WARNED = 10000;

/** Collaborators the observation service needs. */
export interface ITranslationObservationServiceDependencies {
    /** Core database service. */
    database: IDatabaseService;
    /** Module-scoped logger; missing translations are logged as warnings here. */
    logger: ISystemLogService;
    /**
     * Lists the namespaces a key may belong to: `core` plus the id of every
     * discovered plugin. A report naming anything else is dropped.
     */
    listKnownNamespaces: () => string[];
}

/** What a batch did, returned for logging and tests. */
export interface IObservationResult {
    /** Observations that passed validation and were stored. */
    accepted: number;
    /** Observations dropped as malformed, from an unknown namespace, or over the cap. */
    rejected: number;
}

/**
 * Validates and stores reported keys, and logs missing translations once.
 */
export class TranslationObservationService {
    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;
    private readonly listKnownNamespaces: () => string[];

    /**
     * Missing-translation warnings already logged by this process, keyed by
     * language and key, so a busy page logs each gap once rather than on
     * every render.
     */
    private readonly warned = new Set<string>();

    /** Whether the key cap has been reported, so it is logged once rather than per batch. */
    private capReported = false;

    /**
     * @param deps - Collaborators wired by the module.
     */
    constructor(deps: ITranslationObservationServiceDependencies) {
        this.database = deps.database;
        this.logger = deps.logger;
        this.listKnownNamespaces = deps.listKnownNamespaces;
    }

    /**
     * Store a batch of reported keys.
     *
     * @param observations - The untrusted `observations` array from the request body.
     * @returns How many observations were accepted and rejected.
     */
    async record(observations: unknown[]): Promise<IObservationResult> {
        const namespaces = new Set(this.listKnownNamespaces());
        const batch = observations.slice(0, MAX_OBSERVATIONS_PER_BATCH);
        const result: IObservationResult = { accepted: 0, rejected: observations.length - batch.length };
        let keyCount = await this.keys().countDocuments({});

        for (const raw of batch) {
            const observation = this.parse(raw, namespaces);
            if (!observation) {
                result.rejected += 1;
                continue;
            }

            const stored = await this.upsertKey(observation, keyCount < MAX_KEYS);
            if (stored === 'inserted') {
                keyCount += 1;
            }
            if (stored === 'capped') {
                result.rejected += 1;
                this.reportCap();
            } else {
                result.accepted += 1;
            }

            if (observation.missingIn) {
                this.warnMissing(observation);
            }
        }

        return result;
    }

    /**
     * Validate one untrusted observation.
     *
     * @param raw - One element of the request's array.
     * @param namespaces - Namespaces a key may belong to.
     * @returns The observation with clamped fields, or null when it is unusable.
     */
    private parse(raw: unknown, namespaces: Set<string>): ITranslationObservation | null {
        let observation: ITranslationObservation | null = null;
        if (typeof raw === 'object' && raw !== null) {
            const candidate = raw as Record<string, unknown>;
            const namespace = candidate.namespace;
            const key = candidate.key;
            const source = candidate.source;
            const path = candidate.path;
            const valid = typeof namespace === 'string' && namespaces.has(namespace)
                && typeof key === 'string' && KEY_PATTERN.test(key)
                && typeof source === 'string' && source.trim() !== '' && source.length <= MAX_SOURCE_LENGTH
                && typeof path === 'string' && path.startsWith('/');
            if (valid) {
                const missingIn = typeof candidate.missingIn === 'string' && LANGUAGE_CODE_PATTERN.test(candidate.missingIn)
                    ? candidate.missingIn
                    : undefined;
                observation = {
                    namespace: namespace as string,
                    key: key as string,
                    source: source as string,
                    path: (path as string).split('?')[0].slice(0, MAX_PATH_LENGTH),
                    ...(missingIn ? { missingIn } : {})
                };
            }
        }
        return observation;
    }

    /**
     * Insert a new key, or refresh an existing key's source, last-seen time,
     * and path list.
     *
     * When the English text differs from what is stored, the stored text is
     * replaced and `sourceChangedAt` moves forward, which marks existing
     * translations stale on the admin page.
     *
     * @param observation - A validated observation.
     * @param mayInsert - False once the key cap is reached, so only existing keys update.
     * @returns Whether the key was inserted, updated, or refused by the cap.
     */
    private async upsertKey(observation: ITranslationObservation, mayInsert: boolean): Promise<'inserted' | 'updated' | 'capped'> {
        const now = new Date();
        const filter = { namespace: observation.namespace, key: observation.key };
        const existing = await this.keys().findOne(filter, { projection: { source: 1 } });
        let outcome: 'inserted' | 'updated' | 'capped' = 'updated';

        if (!existing && !mayInsert) {
            outcome = 'capped';
        } else if (!existing) {
            // The filter supplies namespace and key on insert, so only the
            // remaining fields ride $setOnInsert.
            const insertFields: Omit<ITranslationKeyDocument, 'namespace' | 'key'> = {
                source: observation.source,
                routes: [observation.path],
                origin: 'observed',
                firstSeenAt: now,
                lastSeenAt: now,
                sourceChangedAt: now
            };
            // A concurrent report of the same key may win the insert. The unique
            // index then rejects the loser with a duplicate-key error, which
            // means the key exists and nothing more needs doing.
            try {
                await this.keys().updateOne(filter, { $setOnInsert: insertFields }, { upsert: true });
                outcome = 'inserted';
            } catch (error) {
                if ((error as { code?: number }).code !== 11000) {
                    throw error;
                }
            }
        } else {
            const set: Partial<ITranslationKeyDocument> = { lastSeenAt: now };
            if (existing.source !== observation.source) {
                set.source = observation.source;
                set.sourceChangedAt = now;
            }
            await this.keys().updateOne(filter, { $set: set });
            // Record the path at the front of the list only when it is new, and
            // keep the list capped so a key used on every blog post does not
            // grow without bound.
            await this.keys().updateOne(
                { ...filter, routes: { $ne: observation.path } },
                { $push: { routes: { $each: [observation.path], $position: 0, $slice: MAX_ROUTES_PER_KEY } } }
            );
        }

        return outcome;
    }

    /**
     * Log, once per process, that a translated page showed English text.
     *
     * @param observation - The observation carrying `missingIn`.
     */
    private warnMissing(observation: ITranslationObservation): void {
        const id = `${observation.missingIn}\u0000${joinKeyId(observation.namespace, observation.key)}`;
        if (!this.warned.has(id) && this.warned.size < MAX_WARNED) {
            this.warned.add(id);
            this.logger.warn(
                {
                    language: observation.missingIn,
                    namespace: observation.namespace,
                    key: observation.key,
                    path: observation.path
                },
                'Missing translation: English text served on a translated page'
            );
        }
    }

    /**
     * Log, once per process, that new keys are being refused because the
     * collection is full.
     */
    private reportCap(): void {
        if (!this.capReported) {
            this.capReported = true;
            this.logger.warn({ maxKeys: MAX_KEYS }, 'Translation key limit reached; new keys are not being recorded');
        }
    }

    /** @returns The keys collection. */
    private keys() {
        return this.database.getCollection<ITranslationKeyDocument>(KEYS_COLLECTION);
    }
}
