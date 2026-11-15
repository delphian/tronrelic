/**
 * @fileoverview Tells admins when new accounts reach the site-wide cap, at
 * most once an hour.
 *
 * Per-address and per-IP limits cannot see a sign-up wave spread across many
 * addresses and networks. Counting every new account is what does, and this
 * alert is how an admin hears about it while it is happening rather than
 * when reading the account list later.
 *
 * - One `warn` entry and one admin notification per alert.
 * - At most one alert an hour, held by a Redis key that expires after an
 *   hour, so a restart or a second backend process does not alert again.
 * - Notification and Redis failures are logged and never fail the sign-up.
 */

import type { INotificationService, ISignupCapConfig, ISystemLogService } from '@/types';
import type { IAuthRateLimitRedis } from './IAuthRateLimitRedis.js';

/** Notification category; admins can silence it on `/system/notifications` or their profile. */
export const SIGNUP_CAP_REACHED_CATEGORY = 'identity.signup-cap-reached';

/** Content type the notification renders through, registered on the content registry. */
export const SIGNUP_CAP_REACHED_CONTENT_TYPE = 'identity:signup-cap-reached';

/** Seconds between alerts; also the span the cap counts over. */
const ALERT_INTERVAL_SECONDS = 3600;

/**
 * Lua script that claims the alert for the next hour.
 *
 * `SET NX EX` writes the key only when it is absent, in one step, so when two
 * requests reach the cap together exactly one of them alerts. The stored
 * value is the alert time, which the admin report shows.
 */
const CLAIM_SCRIPT = `return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])`;

/** Lua script that reads the last alert time, or nil when none was sent in the last hour. */
const READ_SCRIPT = `return redis.call('GET', KEYS[1])`;

/**
 * Sends the sign-up cap alert, at most once an hour.
 *
 * A utility built once by the identity module and handed to the sign-up guard.
 */
export class SignupCapAlerter {
    /** Redis key holding the time of the last alert. */
    private readonly key: string;

    /**
     * @param redis - Redis client the once-an-hour claim is stored in.
     * @param namespace - Deployment Redis namespace (`REDIS_NAMESPACE`).
     * @param resolveNotifications - Looks up the notifications service when an
     *   alert fires. It is published on the registry after this module starts,
     *   and when it is absent the `warn` entry is still written.
     * @param logger - The identity module's logger, so the entry appears on the Logs tab of `/system/users`.
     */
    constructor(
        private readonly redis: IAuthRateLimitRedis,
        namespace: string,
        private readonly resolveNotifications: () => INotificationService | undefined,
        private readonly logger: ISystemLogService
    ) {
        this.key = `${namespace}:auth:signup-cap-alert`;
    }

    /**
     * Alert admins that the cap is reached, unless they were already alerted
     * in the last hour.
     *
     * @param createdLastHour - Accounts created in the last 60 minutes.
     * @param cap - The cap in force; its mode decides what the message says.
     * @returns Resolves once the alert has been sent or skipped.
     */
    async alertIfDue(createdLastHour: number, cap: ISignupCapConfig): Promise<void> {
        let claimed = false;
        try {
            const reply = await this.redis.eval(CLAIM_SCRIPT, 1, this.key, new Date().toISOString(), ALERT_INTERVAL_SECONDS);
            claimed = reply === 'OK';
        } catch (error: unknown) {
            this.logger.error({ err: error }, 'Could not claim the sign-up cap alert; skipping it');
        }
        if (claimed) {
            await this.send(createdLastHour, cap);
        }
    }

    /**
     * Read when admins were last alerted.
     *
     * @returns The alert time as ISO 8601 text, or null when none was sent in
     *   the last hour or Redis could not be read.
     */
    async lastAlertAt(): Promise<string | null> {
        let value: string | null = null;
        try {
            const reply = await this.redis.eval(READ_SCRIPT, 1, this.key);
            value = typeof reply === 'string' ? reply : null;
        } catch (error: unknown) {
            this.logger.warn({ err: error }, 'Could not read the last sign-up cap alert time');
        }
        return value;
    }

    /**
     * Write the `warn` entry and send the admin notification.
     *
     * @param createdLastHour - Accounts created in the last 60 minutes, quoted in the message.
     * @param cap - The cap in force.
     */
    private async send(createdLastHour: number, cap: ISignupCapConfig): Promise<void> {
        const effect = cap.mode === 'enforce'
            ? 'New sign-ups are being refused until the count for the last hour falls below the cap. Existing accounts can still sign in.'
            : 'The cap is set to alert only, so nobody is being refused.';
        const title = 'New accounts reached the sign-up cap';
        const body = `${createdLastHour} accounts were created in the last hour, against a cap of ${cap.maxPerHour}. ${effect} ` +
            'Review the new accounts and the cap on the Sign-ups tab of /system/users.';
        this.logger.warn(
            { createdLastHour, maxPerHour: cap.maxPerHour, mode: cap.mode },
            `New accounts reached the sign-up cap: ${createdLastHour} in the last hour, cap ${cap.maxPerHour} (${cap.mode})`
        );
        const notifications = this.resolveNotifications();
        if (notifications) {
            try {
                await notifications.notify({
                    category: SIGNUP_CAP_REACHED_CATEGORY,
                    typeId: SIGNUP_CAP_REACHED_CONTENT_TYPE,
                    ref: { title, body },
                    severity: 'warning',
                    firedBy: 'identity',
                    data: { createdLastHour, maxPerHour: cap.maxPerHour, mode: cap.mode }
                });
            } catch (error: unknown) {
                this.logger.warn({ err: error }, 'Failed to send the sign-up cap notification');
            }
        }
    }
}
