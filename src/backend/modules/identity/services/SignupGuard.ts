/**
 * @fileoverview Applies the admin-configured sign-up protections: email domain
 * rules and the site-wide cap on new accounts.
 *
 * It runs at two points. A sign-in code request for an address with no
 * account is checked first, so a refused visitor is told before waiting for an
 * email and no email quota is spent. Account creation itself is checked
 * second, from Better Auth's user-create hook, which every sign-in method
 * passes through, including social sign-in that never requests a code.
 *
 * - An address that already has an account is never refused here.
 * - A refused code request is stored as a sign-in event with the refusal's
 *   reason code, because Better Auth's audit hook never sees a request a
 *   before-hook refuses.
 * - A Redis failure while counting a domain's budget lets the request through
 *   and logs an error, for the reason given in `createRedisRateLimitStorage`:
 *   refusing would stop sign-ups while Redis is down.
 * - Concurrent sign-ups can each read a count just below the cap, so the cap
 *   can be passed by a few accounts in a burst. It is a brake, not a quota.
 */

import { APIError } from 'better-auth/api';
import type { ISystemLogService, IEmailDomainRule } from '@/types';
import { DOMAIN_BUDGET_WINDOW_SECONDS, SIGNUP_REFUSAL_REASONS, normalizeEmailDomain } from '@/types';
import type { IAuthRateLimitRedis } from './IAuthRateLimitRedis.js';
import type { ISignInEventRecorder } from './ISignInEventRecorder.js';
import type { ISignupAccountReader } from './ISignupAccountReader.js';
import type { SignupCapAlerter } from './SignupCapAlerter.js';
import type { SignupProtectionConfigStore } from './SignupProtectionConfigStore.js';
import { consumeRedisWindow } from './consumeRedisWindow.js';
import { describeCaller } from './createSignInAuditLog.js';
import { findEmailDomainRule } from './findEmailDomainRule.js';

/** Endpoint that emails a one-time sign-in code. */
const SEND_CODE_PATH = '/email-otp/send-verification-otp';

/** Span the site-wide cap counts over, in seconds. A domain's code budget uses its rule's own window. */
const WINDOW_SECONDS = 3600;

/** Longest address stored on a refusal event, the RFC 5321 limit. */
const MAX_EMAIL_LENGTH = 254;

/** Message shown to a visitor whose email domain is blocked. */
const DOMAIN_BLOCKED_MESSAGE = 'Sign-ups from this email domain are not accepted. Please use a different email address.';

/** Message shown to a visitor whose email domain has used its code budget. */
const DOMAIN_SLOWED_MESSAGE = 'Too many sign-ups from this email domain right now. Please try again later or use a different email address.';

/** Message shown to a new visitor while the cap is enforced and reached. */
const SIGNUPS_PAUSED_MESSAGE = 'New sign-ups are paused for a short while. Please try again later.';

/**
 * One Better Auth request, reduced to the parts the guard reads.
 */
export interface ISignupGuardRequest {
    /** Better Auth endpoint path, such as `/email-otp/send-verification-otp`. */
    path: string;

    /** Parsed request body; read only for `email`. Not yet validated by Better Auth. */
    body: unknown;

    /** Request headers, for recording who made a refused request. */
    headers: Headers | null;
}

/**
 * The guard's collaborators.
 */
export interface ISignupGuardDependencies {
    /** Supplies the settings in force. */
    config: Pick<SignupProtectionConfigStore, 'get'>;

    /** Tells whether an address has an account and counts recent accounts. */
    accounts: ISignupAccountReader;

    /** Redis client holding each slowed domain's shared code budget. */
    redis: IAuthRateLimitRedis;

    /** Deployment Redis namespace (`REDIS_NAMESPACE`). */
    namespace: string;

    /** Sends the once-an-hour alert when the cap is reached. */
    alerter: Pick<SignupCapAlerter, 'alertIfDue'>;

    /** Stores refused code requests as sign-in events. */
    events: ISignInEventRecorder;

    /** The identity module's logger. */
    logger: ISystemLogService;
}

/**
 * Applies the sign-up protections to code requests and account creation.
 *
 * A utility built once by the identity module and handed to the Better Auth
 * factory, whose hooks call it.
 */
export class SignupGuard {
    /**
     * @param deps - Settings, account reads, Redis, alerter, event store, and logger.
     */
    constructor(private readonly deps: ISignupGuardDependencies) {}

    /**
     * Check a sign-in code request. Requests to other endpoints, requests
     * without a valid address, and requests for an address that already has
     * an account pass untouched.
     *
     * The checks run block, then cap, then the domain budget, so a request
     * refused for another reason does not use up the domain's budget.
     *
     * @param request - The Better Auth request.
     * @returns Resolves when the request may proceed.
     * @throws APIError `403` for a blocked domain, `429` when the cap is
     *   enforced and reached or the domain's budget is used up.
     */
    async checkCodeRequest(request: ISignupGuardRequest): Promise<void> {
        const rawEmail: unknown = (request.body as { email?: unknown } | null | undefined)?.email;
        const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH) : '';
        const { signupCap, domainRules } = this.deps.config.get();
        const rule = findEmailDomainRule(domainRules, email);
        const enforcingCap = signupCap.mode === 'enforce';
        const mayRefuse = request.path === SEND_CODE_PATH && normalizeEmailDomain(email) !== null && (rule !== null || enforcingCap);
        if (mayRefuse && !(await this.deps.accounts.hasAccount(email))) {
            if (rule?.action === 'block') {
                await this.refuseCodeRequest(request, email, SIGNUP_REFUSAL_REASONS.domainBlocked, 403, DOMAIN_BLOCKED_MESSAGE);
            }
            if (enforcingCap) {
                const createdLastHour = await this.countLastHour();
                if (createdLastHour >= signupCap.maxPerHour) {
                    void this.deps.alerter.alertIfDue(createdLastHour, signupCap);
                    await this.refuseCodeRequest(request, email, SIGNUP_REFUSAL_REASONS.signupsPaused, 429, SIGNUPS_PAUSED_MESSAGE);
                }
            }
            if (rule?.action === 'slow' && !(await this.withinDomainBudget(rule))) {
                await this.refuseCodeRequest(request, email, SIGNUP_REFUSAL_REASONS.domainSlowed, 429, DOMAIN_SLOWED_MESSAGE);
            }
        }
    }

    /**
     * Check an account about to be created, by any sign-in method.
     *
     * Only `block` rules and an enforced cap apply here. A `slow` rule budgets
     * sign-in codes, which a social sign-in never requests.
     *
     * @param email - The new account's address.
     * @returns Resolves when the account may be created.
     * @throws APIError `403` for a blocked domain, `429` when the cap is enforced and reached.
     */
    async checkAccountCreation(email: string | null | undefined): Promise<void> {
        const { signupCap, domainRules } = this.deps.config.get();
        const rule = findEmailDomainRule(domainRules, email);
        const domain = normalizeEmailDomain(email);
        if (rule?.action === 'block') {
            this.deps.logger.warn({ emailDomain: domain, rule: rule.domain }, 'Account creation refused: the email domain is blocked');
            throw new APIError('FORBIDDEN', { code: SIGNUP_REFUSAL_REASONS.domainBlocked, message: DOMAIN_BLOCKED_MESSAGE });
        }
        if (signupCap.mode === 'enforce') {
            const createdLastHour = await this.countLastHour();
            if (createdLastHour >= signupCap.maxPerHour) {
                void this.deps.alerter.alertIfDue(createdLastHour, signupCap);
                this.deps.logger.warn(
                    { emailDomain: domain, createdLastHour, maxPerHour: signupCap.maxPerHour },
                    'Account creation refused: the sign-up cap is reached'
                );
                throw new APIError('TOO_MANY_REQUESTS', { code: SIGNUP_REFUSAL_REASONS.signupsPaused, message: SIGNUPS_PAUSED_MESSAGE });
            }
        }
    }

    /**
     * Note that an account was just created, alerting admins when it brought
     * the count for the last hour up to the cap. Runs after the account
     * exists, so a failure here is logged and never undoes the sign-up.
     *
     * @returns Resolves once the count has been checked.
     */
    async noteAccountCreated(): Promise<void> {
        const { signupCap } = this.deps.config.get();
        if (signupCap.mode !== 'off') {
            try {
                const createdLastHour = await this.countLastHour();
                if (createdLastHour >= signupCap.maxPerHour) {
                    await this.deps.alerter.alertIfDue(createdLastHour, signupCap);
                }
            } catch (error: unknown) {
                this.deps.logger.error({ err: error }, 'Could not check the sign-up cap after an account was created');
            }
        }
    }

    /** Count accounts created in the last hour, the number the cap is compared with. */
    private countLastHour(): Promise<number> {
        return this.deps.accounts.countCreatedSince(new Date(Date.now() - WINDOW_SECONDS * 1000));
    }

    /**
     * Use one code from a slowed domain's shared budget, counted over the
     * rule's window (an hour or a day).
     *
     * The budget is kept per rule domain, so `a.example.com` and
     * `b.example.com` share the budget of an `example.com` rule. The window is
     * part of the counter's key, so changing a rule from hourly to daily
     * starts a fresh count instead of inheriting an hourly counter's expiry.
     *
     * @param rule - The `slow` rule that matched.
     * @returns True when the budget had room, or when Redis could not be reached.
     */
    private async withinDomainBudget(rule: IEmailDomainRule): Promise<boolean> {
        let allowed = true;
        const budgetWindow = rule.budgetWindow ?? 'hour';
        try {
            const outcome = await consumeRedisWindow(
                this.deps.redis,
                `${this.deps.namespace}:auth:signup-domain:${budgetWindow}:${rule.domain}`,
                DOMAIN_BUDGET_WINDOW_SECONDS[budgetWindow],
                rule.maxCodes ?? 0
            );
            allowed = outcome.allowed;
        } catch (error: unknown) {
            this.deps.logger.error({ err: error, domain: rule.domain }, 'Email domain budget check failed; allowing the request');
        }
        return allowed;
    }

    /**
     * Record and log a refused code request, then refuse it.
     *
     * Only the domain goes in the log entry. The stored event keeps the whole
     * address, like every other sign-in event, so an admin can see exactly
     * which addresses a rule stopped.
     *
     * @param request - The refused request, for the caller details.
     * @param email - The normalized address the code was for.
     * @param reason - The reason code from `SIGNUP_REFUSAL_REASONS`.
     * @param status - HTTP status to answer with.
     * @param message - What the visitor is told.
     * @throws APIError always.
     */
    private async refuseCodeRequest(request: ISignupGuardRequest, email: string, reason: string, status: 403 | 429, message: string): Promise<never> {
        const caller = describeCaller(request.headers);
        this.deps.logger.warn(
            { path: request.path, emailDomain: normalizeEmailDomain(email), reason, ip: caller.ip, country: caller.country },
            'Sign-in code request refused by a sign-up protection'
        );
        try {
            await this.deps.events.record({
                kind: 'code-request-failed',
                method: 'email-otp',
                path: request.path,
                email,
                userId: null,
                sessionId: null,
                ...caller,
                status,
                reason,
                occurredAt: new Date()
            });
        } catch (error: unknown) {
            this.deps.logger.error({ err: error, reason }, 'Failed to store a refused sign-in code request');
        }
        throw new APIError(status === 403 ? 'FORBIDDEN' : 'TOO_MANY_REQUESTS', { code: reason, message });
    }
}
