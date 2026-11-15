/**
 * @fileoverview Stores the admin-configurable sign-up protections: the
 * site-wide cap on new accounts and the email domain rules.
 *
 * The settings are one value in the core `_kv` store under a namespaced key,
 * loaded once at startup and kept in memory, because the sign-up guard reads
 * them on every sign-in code request and every account creation. Every write
 * replaces the in-memory copy and then persists it.
 *
 * - One backend process is assumed. A second process would keep serving its
 *   own copy until it restarts. Within the process, changes are applied one
 *   at a time, so two overlapping admin saves cannot overwrite each other.
 * - Every stored or submitted value is normalized, so a hand-edited or older
 *   stored value can never produce a setting outside the published bounds.
 */

import type {
    DomainBudgetWindow,
    EmailDomainRuleAction,
    IDatabaseService,
    IEmailDomainRule,
    ISignupCapConfig,
    ISignupProtectionConfig,
    ISystemLogService,
    SignupCapMode
} from '@/types';
import { DOMAIN_BUDGET_WINDOW_SECONDS, SIGNUP_PROTECTION_LIMITS, normalizeEmailDomain } from '@/types';

/** Core `_kv` key holding the settings, namespaced by module. */
const CONFIG_KEY = 'identity:sign-up-protection';

/** The cap modes an admin may choose. */
const CAP_MODES: ReadonlyArray<SignupCapMode> = ['off', 'alert', 'enforce'];

/** The domain rule actions an admin may choose. */
const RULE_ACTIONS: ReadonlyArray<EmailDomainRuleAction> = ['block', 'slow'];

/** The spans a slow rule's code budget may be counted over. */
const BUDGET_WINDOWS = Object.keys(DOMAIN_BUDGET_WINDOW_SECONDS) as DomainBudgetWindow[];

/**
 * A rule as it may be stored. Rules saved before the budget window existed
 * hold `maxCodesPerHour` and no `budgetWindow`; {@link SignupProtectionConfigStore.normalize}
 * reads them as an hourly budget.
 */
type IStoredEmailDomainRule = IEmailDomainRuleInput & { maxCodesPerHour?: unknown; updatedAt?: unknown; updatedBy?: unknown };

/**
 * A domain rule as an admin submits it, before it is checked and stamped.
 */
export interface IEmailDomainRuleInput {
    /** The domain, or an address on it, as the admin typed it. */
    domain: unknown;

    /** `block` or `slow`. */
    action: unknown;

    /** Shared code budget per window; required for `slow`, ignored for `block`. */
    maxCodes?: unknown;

    /** `hour` or `day`; for `slow`, defaults to `hour` when absent. Ignored for `block`. */
    budgetWindow?: unknown;

    /** Optional reason for the rule. */
    note?: unknown;
}

/**
 * The result of checking an admin's input: the accepted value, or a message
 * saying what to fix.
 */
export type SignupProtectionInputResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Check a whole-number setting against its bounds.
 *
 * @param value - The submitted value.
 * @param min - Smallest accepted value.
 * @param max - Largest accepted value.
 * @returns The number, or null when it is not a whole number in range.
 */
function boundedInteger(value: unknown, min: number, max: number): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/**
 * Persistent store for the sign-up protection settings.
 *
 * A plain per-module instance rather than a published service: only the
 * identity module's sign-up guard, report, and admin controller use it.
 */
export class SignupProtectionConfigStore {
    /** In-memory copy, loaded once at startup and replaced on every write. */
    private config: ISignupProtectionConfig = {
        signupCap: { ...SIGNUP_PROTECTION_LIMITS.defaultCap },
        domainRules: []
    };

    /**
     * @param database - Core database; the settings live in its `_kv` store.
     * @param logger - The identity module's logger, so every change is recorded on its Logs tab.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Load the stored settings, falling back to the defaults for anything
     * absent or malformed.
     *
     * @returns Resolves once the in-memory copy reflects the stored value.
     */
    async load(): Promise<void> {
        const stored = await this.database.get<Partial<ISignupProtectionConfig>>(CONFIG_KEY);
        this.config = SignupProtectionConfigStore.normalize(stored);
    }

    /**
     * Read the settings in force. Returns a copy so a caller cannot change the
     * shared settings in place.
     *
     * @returns A copy of the current settings.
     */
    get(): ISignupProtectionConfig {
        return {
            signupCap: { ...this.config.signupCap },
            domainRules: this.config.domainRules.map(rule => ({ ...rule }))
        };
    }

    /**
     * Check an admin's cap settings without saving them.
     *
     * @param input - The submitted `mode` and `maxPerHour`.
     * @returns The accepted cap, or a message naming the field to fix.
     */
    static validateCap(input: { mode?: unknown; maxPerHour?: unknown }): SignupProtectionInputResult<ISignupCapConfig> {
        const mode = CAP_MODES.find(candidate => candidate === input.mode);
        const maxPerHour = boundedInteger(input.maxPerHour, SIGNUP_PROTECTION_LIMITS.minPerHour, SIGNUP_PROTECTION_LIMITS.maxPerHour);
        let result: SignupProtectionInputResult<ISignupCapConfig>;
        if (!mode) {
            result = { ok: false, message: `mode must be one of ${CAP_MODES.join(', ')}` };
        } else if (maxPerHour === null) {
            result = { ok: false, message: `maxPerHour must be a whole number from ${SIGNUP_PROTECTION_LIMITS.minPerHour} to ${SIGNUP_PROTECTION_LIMITS.maxPerHour}` };
        } else {
            result = { ok: true, value: { mode, maxPerHour } };
        }
        return result;
    }

    /**
     * Check an admin's domain rule without saving it, and stamp who made it.
     *
     * @param input - The submitted rule.
     * @param actorUserId - The admin making the change, or null for the admin API token.
     * @returns The accepted rule, or a message naming the field to fix.
     */
    static validateDomainRule(input: IEmailDomainRuleInput, actorUserId: string | null): SignupProtectionInputResult<IEmailDomainRule> {
        const domain = normalizeEmailDomain(input.domain);
        const action = RULE_ACTIONS.find(candidate => candidate === input.action);
        const maxCodes = boundedInteger(input.maxCodes, SIGNUP_PROTECTION_LIMITS.minCodes, SIGNUP_PROTECTION_LIMITS.maxCodes);
        const windowGiven = input.budgetWindow !== undefined && input.budgetWindow !== null;
        const budgetWindow = windowGiven
            ? BUDGET_WINDOWS.find(candidate => candidate === input.budgetWindow)
            : SIGNUP_PROTECTION_LIMITS.defaultBudgetWindow;
        const note = input.note === undefined || input.note === null ? '' : input.note;
        let result: SignupProtectionInputResult<IEmailDomainRule>;
        if (!domain) {
            result = { ok: false, message: 'domain must be a domain such as example.com' };
        } else if (!action) {
            result = { ok: false, message: `action must be one of ${RULE_ACTIONS.join(', ')}` };
        } else if (action === 'slow' && maxCodes === null) {
            result = { ok: false, message: `maxCodes must be a whole number from ${SIGNUP_PROTECTION_LIMITS.minCodes} to ${SIGNUP_PROTECTION_LIMITS.maxCodes} for a slow rule` };
        } else if (action === 'slow' && !budgetWindow) {
            result = { ok: false, message: `budgetWindow must be one of ${BUDGET_WINDOWS.join(', ')} for a slow rule` };
        } else if (typeof note !== 'string' || note.trim().length > SIGNUP_PROTECTION_LIMITS.maxNoteLength) {
            result = { ok: false, message: `note must be text of at most ${SIGNUP_PROTECTION_LIMITS.maxNoteLength} characters` };
        } else {
            result = {
                ok: true,
                value: {
                    domain,
                    action,
                    maxCodes: action === 'slow' ? maxCodes : null,
                    budgetWindow: action === 'slow' ? budgetWindow ?? null : null,
                    note: note.trim(),
                    updatedAt: new Date().toISOString(),
                    updatedBy: actorUserId
                }
            };
        }
        return result;
    }

    /**
     * The change most recently queued, so no two changes read the settings at
     * the same time.
     *
     * Every write below reads `this.config`, builds a replacement from it, and
     * only then awaits the database, while `save` replaces the in-memory copy
     * after that await returns. Two overlapping admin requests would therefore
     * both build from the same copy, and whichever wrote last would silently
     * drop the other's change: saving the cap while a domain is being blocked
     * would persist the cap alongside the old rule list and lose the block.
     * Queueing the whole read-modify-write, not just the write, prevents that.
     */
    private pendingMutation: Promise<unknown> = Promise.resolve();

    /**
     * Run one change only after every change already queued has settled, so
     * each one reads the settings its predecessor left behind. A rejection is
     * swallowed from the chain itself, so one failed change cannot block the
     * changes behind it.
     *
     * @param mutate - The whole read-modify-write to run when its turn comes.
     * @returns Whatever the change resolves to, or its rejection.
     */
    private serialize<T>(mutate: () => Promise<T>): Promise<T> {
        const queued = this.pendingMutation.then(mutate, mutate);
        this.pendingMutation = queued.then(() => undefined, () => undefined);
        return queued;
    }

    /**
     * Replace the cap settings and persist them.
     *
     * @param cap - Settings already accepted by {@link validateCap}.
     * @param actorUserId - The admin making the change, recorded in the log.
     * @returns The full settings after the change.
     */
    async setCap(cap: ISignupCapConfig, actorUserId: string | null): Promise<ISignupProtectionConfig> {
        /**
         * Replace the cap on the settings in force, read only once the queue
         * reaches this change, so a domain change saved at the same moment is
         * not overwritten.
         *
         * @returns The full settings after the change.
         */
        const apply = async (): Promise<ISignupProtectionConfig> => {
            const previous = this.config.signupCap;
            await this.save({ ...this.config, signupCap: { ...cap } });
            this.logger.info({ previous, next: cap, actorUserId }, 'Sign-up cap changed');
            return this.get();
        };
        return this.serialize(apply);
    }

    /**
     * Add a domain rule, or replace the rule for the same domain, and persist.
     *
     * @param rule - A rule already accepted by {@link validateDomainRule}.
     * @returns The full settings after the change, or null when the rule is new
     *   and the store already holds the most rules allowed.
     */
    async upsertDomainRule(rule: IEmailDomainRule): Promise<ISignupProtectionConfig | null> {
        /**
         * Merge the rule into the settings in force, read only once the queue
         * reaches this change, so two rules added at the same moment both land
         * and the rule limit is counted against the current list.
         *
         * @returns The settings after the change, or null when the limit is reached.
         */
        const apply = async (): Promise<ISignupProtectionConfig | null> => {
            const others = this.config.domainRules.filter(existing => existing.domain !== rule.domain);
            const isNew = others.length === this.config.domainRules.length;
            let result: ISignupProtectionConfig | null = null;
            if (!isNew || others.length < SIGNUP_PROTECTION_LIMITS.maxDomainRules) {
                await this.save({ ...this.config, domainRules: [...others, { ...rule }] });
                this.logger.info({ rule, created: isNew }, `Email domain rule saved: ${rule.domain} (${rule.action})`);
                result = this.get();
            }
            return result;
        };
        return this.serialize(apply);
    }

    /**
     * Remove the rule for a domain and persist.
     *
     * @param domain - The domain whose rule to remove, in any form `normalizeEmailDomain` accepts.
     * @param actorUserId - The admin making the change, recorded in the log.
     * @returns The full settings after the change, or null when no rule existed for the domain.
     */
    async removeDomainRule(domain: unknown, actorUserId: string | null): Promise<ISignupProtectionConfig | null> {
        /**
         * Drop the domain's rule from the settings in force, read only once
         * the queue reaches this change, so a removal cannot bring back rules
         * another change added or removed in the meantime.
         *
         * @returns The settings after the change, or null when no rule existed.
         */
        const apply = async (): Promise<ISignupProtectionConfig | null> => {
            const normalized = normalizeEmailDomain(domain);
            const remaining = this.config.domainRules.filter(rule => rule.domain !== normalized);
            let result: ISignupProtectionConfig | null = null;
            if (normalized && remaining.length < this.config.domainRules.length) {
                await this.save({ ...this.config, domainRules: remaining });
                this.logger.info({ domain: normalized, actorUserId }, `Email domain rule removed: ${normalized}`);
                result = this.get();
            }
            return result;
        };
        return this.serialize(apply);
    }

    /**
     * Normalize and persist new settings, then make them the ones in force.
     *
     * The value is written before the in-memory copy changes, so a failed
     * write leaves the settings in force matching what is stored.
     *
     * @param next - The settings to save.
     */
    private async save(next: ISignupProtectionConfig): Promise<void> {
        const normalized = SignupProtectionConfigStore.normalize(next);
        await this.database.set(CONFIG_KEY, normalized);
        this.config = normalized;
    }

    /**
     * Turn any stored or merged value into valid settings. A malformed cap
     * falls back to the default cap, and a malformed or duplicate rule is
     * dropped, so the guard always runs against a coherent policy. A slow rule
     * stored before the budget window existed carries `maxCodesPerHour` and no
     * window, and is read as that many codes per hour, which is what it meant.
     *
     * @param raw - The stored value, or settings about to be saved.
     * @returns Complete, valid settings with rules sorted by domain.
     */
    static normalize(raw: Partial<ISignupProtectionConfig> | null | undefined): ISignupProtectionConfig {
        const cap = SignupProtectionConfigStore.validateCap(raw?.signupCap ?? {});
        const seen = new Set<string>();
        const rules: IEmailDomainRule[] = [];
        const stored: IStoredEmailDomainRule[] = Array.isArray(raw?.domainRules) ? raw.domainRules : [];
        for (const original of stored) {
            const candidate: IStoredEmailDomainRule = original ?? { domain: undefined, action: undefined };
            const checked = SignupProtectionConfigStore.validateDomainRule(
                { ...candidate, maxCodes: candidate.maxCodes ?? candidate.maxCodesPerHour },
                null
            );
            if (checked.ok && !seen.has(checked.value.domain) && rules.length < SIGNUP_PROTECTION_LIMITS.maxDomainRules) {
                seen.add(checked.value.domain);
                rules.push({
                    ...checked.value,
                    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : checked.value.updatedAt,
                    updatedBy: typeof candidate.updatedBy === 'string' ? candidate.updatedBy : null
                });
            }
        }
        rules.sort((a, b) => a.domain.localeCompare(b.domain));
        return {
            signupCap: cap.ok ? cap.value : { ...SIGNUP_PROTECTION_LIMITS.defaultCap },
            domainRules: rules
        };
    }
}
