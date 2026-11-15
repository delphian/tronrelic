/**
 * Tests for the sign-up protections: domain matching, the settings store's
 * validation, the sign-up guard's decisions, and the once-an-hour cap alert.
 *
 * Added after a prober on 15 Nov 2026 created eight accounts on a disposable
 * email domain in 45 minutes. Redis, the account reads, and the event store
 * are small fakes, so each test checks one decision.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDatabaseService, IEmailDomainRule, INotificationService, ISignupCapConfig, ISystemLogService } from '@/types';
import { SIGNUP_PROTECTION_LIMITS, SIGNUP_REFUSAL_REASONS, normalizeEmailDomain } from '@/types';
import type { IAuthRateLimitRedis } from '../services/IAuthRateLimitRedis.js';
import type { ISignInEventDocument } from '../database/ISignInEventDocument.js';
import { findEmailDomainRule } from '../services/findEmailDomainRule.js';
import { SignupProtectionConfigStore } from '../services/SignupProtectionConfigStore.js';
import { SignupGuard, type ISignupGuardRequest } from '../services/SignupGuard.js';
import { SignupCapAlerter } from '../services/SignupCapAlerter.js';

/** Endpoint that emails a one-time sign-in code. */
const SEND_PATH = '/email-otp/send-verification-otp';

/**
 * Build a logger double whose methods are spies.
 *
 * @returns A logger the code under test can call freely.
 */
function buildLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

/**
 * Build a stored domain rule.
 *
 * @param domain - The rule's domain.
 * @param action - `block` or `slow`.
 * @param maxCodesPerHour - Budget for a `slow` rule.
 * @returns The rule.
 */
function rule(domain: string, action: 'block' | 'slow', maxCodesPerHour: number | null = null): IEmailDomainRule {
    return { domain, action, maxCodesPerHour, note: '', updatedAt: '2026-11-15T00:00:00.000Z', updatedBy: null };
}

/**
 * Fake Redis that applies the counter script's effect: increment the key and
 * return the count and a fixed time left. `fail` makes every call reject.
 */
class FakeCounterRedis implements IAuthRateLimitRedis {
    readonly counts = new Map<string, number>();
    fail = false;

    /**
     * Increment the key named in the arguments.
     *
     * @param _script - Ignored.
     * @param _numKeys - Ignored.
     * @param args - The key first.
     * @returns `[count, 3600]`.
     */
    async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
        if (this.fail) {
            throw new Error('redis down');
        }
        const key = String(args[0]);
        const count = (this.counts.get(key) ?? 0) + 1;
        this.counts.set(key, count);
        return [count, 3600];
    }
}

/**
 * Collaborators for one guard under test, with the knobs each test turns.
 */
interface IGuardHarness {
    guard: SignupGuard;
    redis: FakeCounterRedis;
    events: ISignInEventDocument[];
    alertIfDue: ReturnType<typeof vi.fn>;
    state: { cap: ISignupCapConfig; rules: IEmailDomainRule[]; existing: Set<string>; createdLastHour: number };
}

/**
 * Build a guard over fakes, with no rules, the cap off, and no accounts.
 *
 * @returns The guard and the fakes behind it.
 */
function buildGuard(): IGuardHarness {
    const state = {
        cap: { mode: 'off', maxPerHour: 10 } as ISignupCapConfig,
        rules: [] as IEmailDomainRule[],
        existing: new Set<string>(),
        createdLastHour: 0
    };
    const redis = new FakeCounterRedis();
    const events: ISignInEventDocument[] = [];
    const alertIfDue = vi.fn(async () => undefined);
    const guard = new SignupGuard({
        config: { get: () => ({ signupCap: state.cap, domainRules: state.rules }) },
        accounts: {
            hasAccount: async (email) => state.existing.has(email),
            countCreatedSince: async () => state.createdLastHour
        },
        redis,
        namespace: 'test',
        alerter: { alertIfDue },
        events: { record: async (event) => { events.push(event); } },
        logger: buildLogger()
    });
    return { guard, redis, events, alertIfDue, state };
}

/**
 * Build a code request for an address.
 *
 * @param email - The address in the body.
 * @param path - The endpoint; defaults to the code request endpoint.
 * @returns The request.
 */
function codeRequest(email: unknown, path: string = SEND_PATH): ISignupGuardRequest {
    return { path, body: { email, type: 'sign-in' }, headers: new Headers({ 'cf-connecting-ip': '203.0.113.7', 'cf-ipcountry': 'RO' }) };
}

describe('normalizeEmailDomain', () => {
    it('accepts a domain or an address in any common form', () => {
        expect(normalizeEmailDomain('Example.COM')).toBe('example.com');
        expect(normalizeEmailDomain('@example.com')).toBe('example.com');
        expect(normalizeEmailDomain('example.com.')).toBe('example.com');
        expect(normalizeEmailDomain('Someone@Mail.Example.com')).toBe('mail.example.com');
    });

    it('rejects values that are not domains', () => {
        expect(normalizeEmailDomain('localhost')).toBeNull();
        expect(normalizeEmailDomain("x'||(select 1)--@invalid")).toBeNull();
        expect(normalizeEmailDomain('{"$ne":null}')).toBeNull();
        expect(normalizeEmailDomain(42)).toBeNull();
    });
});

describe('findEmailDomainRule', () => {
    it('matches the domain and its subdomains, but not a name that only ends the same way', () => {
        const rules = [rule('example.com', 'block')];
        expect(findEmailDomainRule(rules, 'a@example.com')?.domain).toBe('example.com');
        expect(findEmailDomainRule(rules, 'a@mail.example.com')?.domain).toBe('example.com');
        expect(findEmailDomainRule(rules, 'a@badexample.com')).toBeNull();
    });

    it('prefers the rule for the longest matching domain', () => {
        const rules = [rule('example.com', 'block'), rule('mail.example.com', 'slow', 3)];
        expect(findEmailDomainRule(rules, 'a@mail.example.com')?.action).toBe('slow');
        expect(findEmailDomainRule(rules, 'a@other.example.com')?.action).toBe('block');
    });
});

describe('SignupProtectionConfigStore validation', () => {
    it('requires a code budget for a slow rule and clears it for a block rule', () => {
        expect(SignupProtectionConfigStore.validateDomainRule({ domain: 'example.com', action: 'slow' }, null).ok).toBe(false);
        const block = SignupProtectionConfigStore.validateDomainRule({ domain: '@Example.com', action: 'block', maxCodesPerHour: 5 }, 'admin-1');
        expect(block).toMatchObject({ ok: true, value: { domain: 'example.com', action: 'block', maxCodesPerHour: null, updatedBy: 'admin-1' } });
    });

    it('rejects a cap outside the published bounds', () => {
        expect(SignupProtectionConfigStore.validateCap({ mode: 'enforce', maxPerHour: 0 }).ok).toBe(false);
        expect(SignupProtectionConfigStore.validateCap({ mode: 'sometimes', maxPerHour: 5 }).ok).toBe(false);
        expect(SignupProtectionConfigStore.validateCap({ mode: 'enforce', maxPerHour: 5 }).ok).toBe(true);
    });

    it('falls back to the default cap and drops malformed or duplicate rules from a stored value', () => {
        const normalized = SignupProtectionConfigStore.normalize({
            signupCap: { mode: 'bogus', maxPerHour: -1 } as unknown as ISignupCapConfig,
            domainRules: [rule('b.com', 'block'), rule('B.com', 'block'), { domain: 'not a domain' } as unknown as IEmailDomainRule, rule('a.com', 'slow', 2)]
        });
        expect(normalized.signupCap).toEqual(SIGNUP_PROTECTION_LIMITS.defaultCap);
        expect(normalized.domainRules.map(r => r.domain)).toEqual(['a.com', 'b.com']);
    });
});

describe('SignupProtectionConfigStore concurrent changes', () => {
    // Codex review on PR #736: two overlapping saves built their replacement
    // from the same stale copy, so the later one silently dropped the earlier
    // one's change, such as a domain block lost to a cap save.
    it('keeps both changes when a cap save and a domain rule save overlap', async () => {
        let stored: unknown = null;
        const database = {
            get: async () => stored,
            set: async (_key: string, value: unknown) => {
                await new Promise(resolve => setTimeout(resolve, 5));
                stored = value;
            }
        } as unknown as IDatabaseService;
        const store = new SignupProtectionConfigStore(database, buildLogger());
        await store.load();

        const block = SignupProtectionConfigStore.validateDomainRule({ domain: 'fldubai.com', action: 'block' }, null);
        if (!block.ok) {
            throw new Error('test rule should be valid');
        }
        await Promise.all([
            store.upsertDomainRule(block.value),
            store.setCap({ mode: 'enforce', maxPerHour: 5 }, null)
        ]);

        const saved = SignupProtectionConfigStore.normalize(stored as never);
        expect(saved.signupCap).toEqual({ mode: 'enforce', maxPerHour: 5 });
        expect(saved.domainRules.map(r => r.domain)).toEqual(['fldubai.com']);
        expect(store.get().domainRules.map(r => r.domain)).toEqual(['fldubai.com']);
    });
});

describe('SignupGuard.checkCodeRequest', () => {
    let harness: IGuardHarness;

    beforeEach(() => {
        harness = buildGuard();
    });

    it('refuses a blocked domain with 403 and stores the refusal as a sign-in event', async () => {
        harness.state.rules = [rule('fldubai.com', 'block')];

        await expect(harness.guard.checkCodeRequest(codeRequest('Farm1@FLDubai.com'))).rejects.toMatchObject({
            statusCode: 403,
            body: expect.objectContaining({ code: SIGNUP_REFUSAL_REASONS.domainBlocked })
        });
        expect(harness.events).toEqual([
            expect.objectContaining({
                kind: 'code-request-failed',
                email: 'farm1@fldubai.com',
                reason: SIGNUP_REFUSAL_REASONS.domainBlocked,
                status: 403,
                ip: '203.0.113.7',
                country: 'RO'
            })
        ]);
    });

    // A rule must never lock out someone who already has an account.
    it('lets an address with an account through even when its domain is blocked', async () => {
        harness.state.rules = [rule('fldubai.com', 'block')];
        harness.state.existing.add('member@fldubai.com');

        await expect(harness.guard.checkCodeRequest(codeRequest('member@fldubai.com'))).resolves.toBeUndefined();
    });

    it('ignores endpoints other than the code request', async () => {
        harness.state.rules = [rule('fldubai.com', 'block')];

        await expect(harness.guard.checkCodeRequest(codeRequest('farm1@fldubai.com', '/sign-in/email-otp'))).resolves.toBeUndefined();
    });

    it('gives a slowed domain one shared budget across different addresses', async () => {
        harness.state.rules = [rule('fldubai.com', 'slow', 2)];

        await harness.guard.checkCodeRequest(codeRequest('a@fldubai.com'));
        await harness.guard.checkCodeRequest(codeRequest('b@mail.fldubai.com'));
        await expect(harness.guard.checkCodeRequest(codeRequest('c@fldubai.com'))).rejects.toMatchObject({
            statusCode: 429,
            body: expect.objectContaining({ code: SIGNUP_REFUSAL_REASONS.domainSlowed })
        });
    });

    it('lets a slowed domain through when Redis cannot be reached', async () => {
        harness.state.rules = [rule('fldubai.com', 'slow', 1)];
        harness.redis.fail = true;

        await expect(harness.guard.checkCodeRequest(codeRequest('a@fldubai.com'))).resolves.toBeUndefined();
    });

    it('refuses new addresses and alerts when the enforced cap is reached', async () => {
        harness.state.cap = { mode: 'enforce', maxPerHour: 10 };
        harness.state.createdLastHour = 10;

        await expect(harness.guard.checkCodeRequest(codeRequest('new@example.com'))).rejects.toMatchObject({
            statusCode: 429,
            body: expect.objectContaining({ code: SIGNUP_REFUSAL_REASONS.signupsPaused })
        });
        expect(harness.alertIfDue).toHaveBeenCalledWith(10, harness.state.cap);
    });

    it('never refuses while the cap only alerts', async () => {
        harness.state.cap = { mode: 'alert', maxPerHour: 10 };
        harness.state.createdLastHour = 50;

        await expect(harness.guard.checkCodeRequest(codeRequest('new@example.com'))).resolves.toBeUndefined();
    });

    // The budget check runs last, so a request refused for another reason
    // does not use up the domain's budget.
    it('does not spend a slowed domain budget on a request the cap refuses', async () => {
        harness.state.rules = [rule('fldubai.com', 'slow', 5)];
        harness.state.cap = { mode: 'enforce', maxPerHour: 1 };
        harness.state.createdLastHour = 1;

        await expect(harness.guard.checkCodeRequest(codeRequest('a@fldubai.com'))).rejects.toThrow();
        expect(harness.redis.counts.size).toBe(0);
    });
});

describe('SignupGuard account creation', () => {
    let harness: IGuardHarness;

    beforeEach(() => {
        harness = buildGuard();
    });

    // Social sign-in never requests a code, so creation is checked as well.
    it('refuses to create an account on a blocked domain', async () => {
        harness.state.rules = [rule('fldubai.com', 'block')];

        await expect(harness.guard.checkAccountCreation('farm@fldubai.com')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('does not apply a slow rule to account creation', async () => {
        harness.state.rules = [rule('fldubai.com', 'slow', 1)];

        await expect(harness.guard.checkAccountCreation('farm@fldubai.com')).resolves.toBeUndefined();
    });

    it('refuses account creation while the enforced cap is reached', async () => {
        harness.state.cap = { mode: 'enforce', maxPerHour: 3 };
        harness.state.createdLastHour = 3;

        await expect(harness.guard.checkAccountCreation('new@example.com')).rejects.toMatchObject({ statusCode: 429 });
    });

    it('alerts after an account brings the count up to the cap, and not before', async () => {
        harness.state.cap = { mode: 'alert', maxPerHour: 3 };
        harness.state.createdLastHour = 2;
        await harness.guard.noteAccountCreated();
        expect(harness.alertIfDue).not.toHaveBeenCalled();

        harness.state.createdLastHour = 3;
        await harness.guard.noteAccountCreated();
        expect(harness.alertIfDue).toHaveBeenCalledTimes(1);
    });

    it('never alerts while the cap is off', async () => {
        harness.state.createdLastHour = 500;

        await harness.guard.noteAccountCreated();
        expect(harness.alertIfDue).not.toHaveBeenCalled();
    });
});

describe('SignupCapAlerter', () => {
    /**
     * Fake Redis for the alert claim: the first `SET NX` answers `OK`, later
     * ones answer null, and `GET` returns the stored value.
     */
    class FakeClaimRedis implements IAuthRateLimitRedis {
        value: string | null = null;

        /**
         * Apply `SET NX` or `GET`, told apart by the number of arguments.
         *
         * @param _script - Ignored.
         * @param _numKeys - Ignored.
         * @param args - The key, then the value and expiry for a claim.
         * @returns `OK` or null for a claim; the stored value for a read.
         */
        async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
            let reply: unknown = this.value;
            if (args.length > 1) {
                reply = this.value === null ? 'OK' : null;
                this.value = this.value ?? String(args[1]);
            }
            return reply;
        }
    }

    it('sends one notification an hour, however many times the cap is reached', async () => {
        const redis = new FakeClaimRedis();
        const notify = vi.fn(async () => undefined);
        const alerter = new SignupCapAlerter(redis, 'test', () => ({ notify } as unknown as INotificationService), buildLogger());
        const cap: ISignupCapConfig = { mode: 'enforce', maxPerHour: 10 };

        await alerter.alertIfDue(10, cap);
        await alerter.alertIfDue(11, cap);

        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({ category: 'identity.signup-cap-reached', severity: 'warning' }));
        expect(await alerter.lastAlertAt()).toBe(redis.value);
    });
});
