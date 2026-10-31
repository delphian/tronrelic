/**
 * @fileoverview Bot rules service — the operator's rules for identifying
 * automated traffic, stored as data.
 *
 * ## Why This Service Exists
 *
 * The built-in classifier recognises crawlers that name themselves. A browser
 * fleet that runs real Chrome and hides its automation is recognisable only
 * from what an operator learns about it: its network, country, exact browser
 * build, the pages it reads, and how its requests relate to each other. This
 * service holds that knowledge as rules an operator edits on `/system/traffic`,
 * so a new crawler no longer needs a code change. It replaced the ASN-only
 * automated-network list; migration 022 moved each listed network into a rule.
 *
 * ## Design Decisions
 *
 * - **Write-time, forward-only.** Like every classifier signal, a rule's label
 *   is set when an event is written. Adding, changing, or removing a rule never
 *   relabels events already stored.
 * - **Labels, never blocks.** A matched visitor is still served every page;
 *   only the analytics label changes. Blocking belongs in Cloudflare.
 * - **Monitor before label.** A rule in `monitor` mode records which events it
 *   matched (in `traffic_events.bot_rule`) without changing their label, so an
 *   operator can watch a rule on real traffic first. A rule an AI agent proposed
 *   always starts in monitor mode once a curator approves it.
 * - **Cached in memory.** Every traffic event is checked, so the active rules
 *   are compiled into an in-memory list at init, after every change, and on a
 *   one-minute timer (for rules a migration wrote directly), and the per-event
 *   check never waits on the database.
 * - **Singleton**, matching the module's other services for consistent DI.
 */

import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import type {
    BotRuleLabel,
    BotRuleMode,
    BotRuleSource,
    BotRuleStatus,
    IBotRule,
    IBotRuleConditions,
    IBotRuleInput,
    IBotRulePreview,
    IDatabaseService,
    ISystemLogService
} from '@/types';
import { selectBotRuleMatch, type IBotRuleMatch, type IBotRuleMatcher, type IBotRuleSignals, type ICompiledBotRule } from './bot-rule-matcher.js';
import { validateBotRuleInput } from './bot-rule-validation.js';

/** Physical collection name for the bot rules. */
export const BOT_RULES_COLLECTION = 'module_traffic_bot_rules';

/**
 * A bot rule as stored in MongoDB. Dates are real `Date` values here and are
 * converted to ISO strings by {@link toWire} for the API.
 */
export interface IBotRuleDocument {
    /** Stable id, also written to `traffic_events.bot_rule`. */
    id: string;
    /** Short name. */
    name: string;
    /** Why the rule exists, or null. */
    note: string | null;
    /** Normalised conditions. */
    conditions: IBotRuleConditions;
    /** Label applied in `label` mode. */
    label: BotRuleLabel;
    /** `monitor` or `label`. */
    mode: BotRuleMode;
    /** False pauses the rule. */
    enabled: boolean;
    /** Review state; only `active` rules are evaluated. */
    status: BotRuleStatus;
    /** Who created the rule. */
    source: BotRuleSource;
    /** Preview recorded when an AI agent proposed the rule, or null. */
    evidence: IBotRulePreview | null;
    /** Expiry, or null for none. */
    expiresAt: Date | null;
    /** Creation time. */
    createdAt: Date;
    /** Last change. */
    updatedAt: Date;
}

/**
 * Thrown when a rule id names no stored rule. The controller maps it to 404.
 */
export class BotRuleNotFoundError extends Error {
    /**
     * @param id - The id that was not found, included so the message names it.
     */
    constructor(id: string) {
        super(`No bot rule with id ${id}`);
        this.name = 'BotRuleNotFoundError';
    }
}

/**
 * Convert a stored rule to the API shape.
 *
 * @param doc - The stored document.
 * @returns The rule with ISO date strings and no MongoDB `_id`.
 */
function toWire(doc: IBotRuleDocument): IBotRule {
    return {
        id: doc.id,
        name: doc.name,
        note: doc.note,
        conditions: doc.conditions,
        label: doc.label,
        mode: doc.mode,
        enabled: doc.enabled,
        status: doc.status,
        source: doc.source,
        evidence: doc.evidence ?? null,
        expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString()
    };
}

/**
 * Stores bot rules and answers the per-event match from an in-memory copy of
 * the active ones.
 */
export class BotRulesService implements IBotRuleMatcher {
    private static instance: BotRulesService | undefined;
    private readonly collection: Collection<IBotRuleDocument>;

    /** Active, enabled rules compiled for matching, oldest first. */
    private compiled: readonly ICompiledBotRule[] = [];

    /**
     * Number of the most recent {@link load} to have started. Two overlapping
     * changes each reload, and their queries can finish in either order; a
     * reload writes the cache only while it still holds the latest number, so
     * an older snapshot never replaces a newer one.
     */
    private loadGeneration = 0;

    /**
     * Private constructor enforces the singleton. Use setDependencies() and getInstance().
     *
     * @param database - Database service holding the rules collection.
     * @param logger - Traffic-module logger, so rule changes appear on its Logs tab.
     */
    private constructor(
        database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection<IBotRuleDocument>(BOT_RULES_COLLECTION);
    }

    /**
     * Initialize the singleton. The traffic module calls this during init().
     *
     * @param database - Database service.
     * @param logger - Traffic-module logger.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!BotRulesService.instance) {
            BotRulesService.instance = new BotRulesService(database, logger);
        }
    }

    /**
     * Return the shared instance, so the admin routes, the curation type, the AI
     * tool, and ingestion all read and write one cached rule set.
     *
     * @throws Error if setDependencies() has not been called first.
     * @returns The singleton instance.
     */
    public static getInstance(): BotRulesService {
        if (!BotRulesService.instance) {
            throw new Error('BotRulesService.setDependencies() must be called before getInstance()');
        }
        return BotRulesService.instance;
    }

    /**
     * Clear the singleton so each test starts fresh. Test-only.
     */
    public static resetInstance(): void {
        BotRulesService.instance = undefined;
    }

    /**
     * Create the indexes: a unique id, and the status the cache loads by.
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ id: 1 }, { unique: true, name: 'bot_rule_id_unique' });
        await this.collection.createIndex({ status: 1, createdAt: 1 }, { name: 'bot_rule_status_created' });
    }

    /**
     * Load the active, enabled rules into memory. Called during init() and after
     * every change. Expiry is checked per event rather than here, so a rule
     * stops matching the moment it expires without a reload.
     */
    async load(): Promise<void> {
        const generation = ++this.loadGeneration;
        const rows = await this.collection
            .find({ status: 'active', enabled: true }, { projection: { _id: 0 } })
            .sort({ createdAt: 1 })
            .toArray();
        if (generation === this.loadGeneration) {
            this.compiled = rows.map(row => ({
                id: row.id,
                label: row.label,
                mode: row.mode,
                conditions: row.conditions,
                expiresAt: row.expiresAt ? row.expiresAt.getTime() : null
            }));
        }
    }

    /**
     * Reload the rules on a timer. Every change made through this service
     * reloads at once, but a migration writes the collection directly, so
     * without this the rules it created would not apply until the next restart
     * or rule change. A failed reload keeps the previous set and is logged.
     *
     * @param intervalMs - Time between reloads.
     * @returns A function that stops the timer.
     */
    startPeriodicReload(intervalMs: number): () => void {
        const timer = setInterval(() => {
            this.load().catch(error => this.logger.warn({ error }, 'Failed to reload bot rules; keeping the previous set'));
        }, intervalMs);
        timer.unref();
        return () => clearInterval(timer);
    }

    /**
     * Find the rule an event matches, from the in-memory set.
     *
     * @param signals - The event's request signals.
     * @returns The match, or null.
     */
    match(signals: IBotRuleSignals): IBotRuleMatch | null {
        return selectBotRuleMatch(this.compiled, signals);
    }

    /**
     * Networks named by an active rule, so the suggestions panel does not
     * propose a network that is already covered.
     *
     * @returns The set of covered ASNs.
     */
    coveredAsns(): ReadonlySet<number> {
        const asns = new Set<number>();
        for (const rule of this.compiled) {
            for (const asn of rule.conditions.asns ?? []) {
                asns.add(asn);
            }
        }
        return asns;
    }

    /**
     * List every rule for the admin page, newest first.
     *
     * @returns All rules, including proposed and rejected ones.
     */
    async list(): Promise<IBotRule[]> {
        const rows = await this.collection.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
        return rows.map(toWire);
    }

    /**
     * Read one rule.
     *
     * @param id - Rule id.
     * @returns The rule, or null when none has the id.
     */
    async get(id: string): Promise<IBotRule | null> {
        const row = await this.collection.findOne({ id }, { projection: { _id: 0 } });
        return row ? toWire(row) : null;
    }

    /**
     * Create a rule an admin wrote. It is active straight away.
     *
     * @param input - Raw rule input from the request body.
     * @returns The stored rule.
     * @throws BotRuleValidationError when the input is invalid.
     */
    async create(input: unknown): Promise<IBotRule> {
        const valid = validateBotRuleInput(input);
        const doc = this.buildDocument(valid, 'active', 'admin', null);
        await this.collection.insertOne({ ...doc });
        await this.load();
        this.logger.info({ ruleId: doc.id, name: doc.name, mode: doc.mode }, 'Created bot rule');
        return toWire(doc);
    }

    /**
     * Replace a rule's editable fields. Its status, source, and evidence stay
     * as they were, so editing a proposed rule does not activate it.
     *
     * @param id - Rule id.
     * @param input - Raw rule input from the request body.
     * @returns The updated rule.
     * @throws BotRuleValidationError when the input is invalid.
     * @throws BotRuleNotFoundError when no rule has the id.
     */
    async update(id: string, input: unknown): Promise<IBotRule> {
        const valid = validateBotRuleInput(input);
        const updated = await this.collection.findOneAndUpdate(
            { id },
            {
                $set: {
                    name: valid.name,
                    note: valid.note,
                    conditions: valid.conditions,
                    label: valid.label,
                    mode: valid.mode,
                    enabled: valid.enabled,
                    expiresAt: valid.expiresAt ? new Date(valid.expiresAt) : null,
                    updatedAt: new Date()
                }
            },
            { returnDocument: 'after', projection: { _id: 0 } }
        );
        if (!updated) {
            throw new BotRuleNotFoundError(id);
        }
        await this.load();
        this.logger.info({ ruleId: id, mode: valid.mode, enabled: valid.enabled }, 'Updated bot rule');
        return toWire(updated);
    }

    /**
     * Delete a rule. Events it already labeled keep their label and its id.
     *
     * @param id - Rule id.
     * @returns True when a rule was deleted.
     */
    async remove(id: string): Promise<boolean> {
        const result = await this.collection.deleteOne({ id });
        await this.load();
        if (result.deletedCount > 0) {
            this.logger.info({ ruleId: id }, 'Deleted bot rule');
        }
        return result.deletedCount > 0;
    }

    /**
     * Count rules waiting for a curator, so the propose tool can refuse once the
     * queue is full rather than let a looping agent flood it.
     *
     * @returns Number of rules with status `proposed`.
     */
    async countProposed(): Promise<number> {
        return this.collection.countDocuments({ status: 'proposed' });
    }

    /**
     * Store a rule an AI agent proposed. It waits as `proposed` and matches
     * nothing until a curator approves it, and its mode is forced to `monitor`
     * so approval can never relabel traffic on its own.
     *
     * @param input - Already-validated rule input.
     * @param evidence - The preview the agent saw, kept for the curator.
     * @returns The stored rule.
     */
    async propose(input: Required<IBotRuleInput>, evidence: IBotRulePreview | null): Promise<IBotRule> {
        const doc = this.buildDocument({ ...input, mode: 'monitor', enabled: true }, 'proposed', 'ai-tool', evidence);
        await this.collection.insertOne({ ...doc });
        this.logger.info({ ruleId: doc.id, name: doc.name }, 'Stored proposed bot rule for curator review');
        return toWire(doc);
    }

    /**
     * Apply a curator's decision to a proposed rule. Approval activates it in
     * monitor mode; rejection keeps it as a record. A rule that is no longer
     * proposed (already decided, or edited away) is left alone.
     *
     * @param id - Rule id from the curation item.
     * @param status - `active` to approve, `rejected` to reject.
     * @returns True when the rule was proposed and is now decided.
     */
    async decideProposal(id: string, status: 'active' | 'rejected'): Promise<boolean> {
        const set: Partial<IBotRuleDocument> = { status, updatedAt: new Date() };
        if (status === 'active') {
            set.mode = 'monitor';
            set.enabled = true;
        }
        const result = await this.collection.updateOne({ id, status: 'proposed' }, { $set: set });
        await this.load();
        return result.modifiedCount > 0;
    }

    /**
     * Build a new rule document.
     *
     * @param input - Validated rule input.
     * @param status - Initial review state.
     * @param source - Who created the rule.
     * @param evidence - Preview to keep with the rule, or null.
     * @returns The document, ready to insert.
     */
    private buildDocument(
        input: Required<IBotRuleInput>,
        status: BotRuleStatus,
        source: BotRuleSource,
        evidence: IBotRulePreview | null
    ): IBotRuleDocument {
        const now = new Date();
        return {
            id: randomUUID(),
            name: input.name,
            note: input.note,
            conditions: input.conditions,
            label: input.label,
            mode: input.mode,
            enabled: input.enabled,
            status,
            source,
            evidence,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            createdAt: now,
            updatedAt: now
        };
    }
}
