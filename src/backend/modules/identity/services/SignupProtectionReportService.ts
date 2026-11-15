/**
 * @fileoverview Builds the report on the Sign-ups tab of `/system/users`:
 * the settings, where new accounts stand against the cap, what the
 * protections refused, and which email domains new accounts come from.
 *
 * Every figure is read when the report is requested, from the accounts and
 * the stored sign-in events, so nothing has to be kept up to date between
 * requests and the report cannot drift from what actually happened.
 */

import type { IEmailDomainActivity, ISignupProtectionReport, ISignupRefusalCount } from '@/types';
import { SIGNUP_REFUSAL_REASONS } from '@/types';
import type { AccountDirectoryService } from './account-directory.service.js';
import type { SignInEventStore } from './SignInEventStore.js';
import type { SignupCapAlerter } from './SignupCapAlerter.js';
import type { SignupProtectionConfigStore } from './SignupProtectionConfigStore.js';
import { findEmailDomainRule } from './findEmailDomainRule.js';

/** Milliseconds in one hour. */
const HOUR_MS = 3600 * 1000;

/** Most email domains listed, after merging new accounts and refusals. */
const DOMAIN_LIST_LIMIT = 25;

/** Every sign-up refusal reason code, in the order the report lists them. */
const REFUSAL_REASONS: ReadonlyArray<string> = Object.values(SIGNUP_REFUSAL_REASONS);

/**
 * The reads the report needs, narrowed from the services that provide them.
 */
export interface ISignupProtectionReportSources {
    /** The settings in force. */
    config: Pick<SignupProtectionConfigStore, 'get'>;

    /** Account counts. */
    accounts: Pick<AccountDirectoryService, 'countCreatedSince' | 'countCreatedByEmailDomainSince'>;

    /** Refusal counts from the stored sign-in events. */
    events: Pick<SignInEventStore, 'countByReasonSince' | 'countByEmailDomainSince'>;

    /** When admins were last alerted about the cap. */
    alerter: Pick<SignupCapAlerter, 'lastAlertAt'>;
}

/**
 * Builds the sign-up protection report for the admin page.
 */
export class SignupProtectionReportService {
    /**
     * @param sources - Settings, account counts, refusal counts, and the last alert time.
     */
    constructor(private readonly sources: ISignupProtectionReportSources) {}

    /**
     * Build the report.
     *
     * @returns The settings and every figure the Sign-ups tab shows.
     */
    async build(): Promise<ISignupProtectionReport> {
        const now = Date.now();
        const hourAgo = new Date(now - HOUR_MS);
        const dayAgo = new Date(now - 24 * HOUR_MS);
        const weekAgo = new Date(now - 7 * 24 * HOUR_MS);
        const config = this.sources.config.get();

        const [createdLastHour, createdLast24Hours, refusalsDay, refusalsWeek, newByDomain, refusedByDomain, lastAlertAt] = await Promise.all([
            this.sources.accounts.countCreatedSince(hourAgo),
            this.sources.accounts.countCreatedSince(dayAgo),
            this.sources.events.countByReasonSince(REFUSAL_REASONS, dayAgo),
            this.sources.events.countByReasonSince(REFUSAL_REASONS, weekAgo),
            this.sources.accounts.countCreatedByEmailDomainSince(weekAgo, DOMAIN_LIST_LIMIT),
            this.sources.events.countByEmailDomainSince(REFUSAL_REASONS, weekAgo, DOMAIN_LIST_LIMIT),
            this.sources.alerter.lastAlertAt()
        ]);

        const refusals: ISignupRefusalCount[] = REFUSAL_REASONS.map(reason => ({
            reason,
            last24Hours: refusalsDay.find(row => row.reason === reason)?.count ?? 0,
            last7Days: refusalsWeek.find(row => row.reason === reason)?.count ?? 0
        }));

        const byDomain = new Map<string, IEmailDomainActivity>();
        /**
         * Find or start the row for one domain, so the two lists merge into one.
         *
         * @param domain - The email domain.
         * @returns The row to add counts to.
         */
        const rowFor = (domain: string): IEmailDomainActivity => {
            const existing = byDomain.get(domain);
            const row = existing ?? {
                domain,
                newAccounts: 0,
                refusals: 0,
                ruleAction: findEmailDomainRule(config.domainRules, domain)?.action ?? null
            };
            byDomain.set(domain, row);
            return row;
        };
        newByDomain.forEach(({ domain, count }) => { rowFor(domain).newAccounts = count; });
        refusedByDomain.forEach(({ domain, count }) => { rowFor(domain).refusals = count; });
        const domainActivity = [...byDomain.values()]
            .sort((a, b) => (b.newAccounts + b.refusals) - (a.newAccounts + a.refusals) || a.domain.localeCompare(b.domain))
            .slice(0, DOMAIN_LIST_LIMIT);

        return {
            config,
            cap: {
                createdLastHour,
                createdLast24Hours,
                reached: config.signupCap.mode !== 'off' && createdLastHour >= config.signupCap.maxPerHour,
                lastAlertAt
            },
            refusals,
            domainActivity,
            generatedAt: new Date(now).toISOString()
        };
    }
}
