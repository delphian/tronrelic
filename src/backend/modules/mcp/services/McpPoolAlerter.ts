/**
 * @fileoverview Tells admins when an MCP group's shared daily call pool runs
 * out, once, instead of leaving them to find it on the usage view.
 *
 * When a group's pool (`callsPerDayGroup`) is spent, every call charged to that
 * group is refused until its 24-hour window resets. For `anonymous` that means
 * every visitor without an account is locked out for the rest of the window,
 * which an admin needs to hear about while there is still time to raise the
 * limit. This watcher reads each governed call from the `ai.toolInvoked` hook
 * and raises one `warn` and one admin notification when a group's pool first
 * refuses a call.
 *
 * Facts about the alert:
 * - A group is alerted once per exhaustion. It can be alerted again only after
 *   a call charged to it that started after that exhaustion was seen succeeds,
 *   which shows the pool has room again. A call already running when the pool
 *   ran out was charged while the pool still had room, so its late success is
 *   no evidence of recovery.
 * - State is per process; a restart or a second instance may alert once more.
 * - Notification and policy failures are logged and never affect the call.
 */

import type { INotificationService, ISystemLogService, IToolInvocationRecord } from '@/types';
import type { McpGroupPolicyService } from './McpGroupPolicyService.js';

/** Notification category for an exhausted pool; admins can silence it on `/system/notifications` or their profile. */
export const MCP_POOL_EXHAUSTED_CATEGORY = 'mcp.pool-exhausted';

/** Content type the notification renders through, registered on the central content registry. */
export const MCP_POOL_EXHAUSTED_CONTENT_TYPE = 'mcp:pool-exhausted';

/**
 * Watches governed MCP calls and alerts admins when a group's daily pool runs out.
 *
 * A utility rather than a shared service: the MCP module builds one and feeds
 * it from the hook it already registers for the accounting meter.
 */
export class McpPoolAlerter {
    /**
     * Groups whose pool has refused a call and have not yet been seen to have
     * room again, each mapped to the moment that exhaustion was first seen.
     * Keeping the moment is what stops a call admitted before it from re-arming
     * the alert and sending a second notification for the same exhaustion.
     */
    private readonly exhausted = new Map<string, number>();

    /**
     * @param policies - Reads the group's pool limit for the alert text.
     * @param resolveNotifications - Looks up the notifications service when an
     *   alert fires. Resolved per alert because the service is published on the
     *   registry; when it is absent the `warn` entry is still written.
     * @param logger - The MCP module's logger, so the entry appears on the Logs
     *   tab of `/system/mcp`.
     */
    constructor(
        private readonly policies: Pick<McpGroupPolicyService, 'getPolicies' | 'policyFor'>,
        private readonly resolveNotifications: () => INotificationService | undefined,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Note one governed call, alerting when it is the first a group's pool refused.
     *
     * Calls on other trigger paths, and calls charged to no group, are
     * ignored. A successful call clears the group's exhausted state only when
     * it started after that exhaustion was seen, because only such a call was
     * admitted by a pool that had room. Returns at once; the alert itself runs
     * in the background.
     *
     * @param record - The audit record the governor wrote for the call.
     */
    observe(record: IToolInvocationRecord): void {
        const groupId = record.origin?.chargedGroupId;
        if (record.triggerPath === 'mcp' && groupId) {
            const exhaustedAt = this.exhausted.get(groupId);
            if (record.limitHit === 'pool-day' && exhaustedAt === undefined) {
                this.exhausted.set(groupId, Date.now());
                void this.alert(groupId, record);
            } else if (record.status === 'ok' && exhaustedAt !== undefined && this.startedAfter(record, exhaustedAt)) {
                this.exhausted.delete(groupId);
                this.logger.info({ groupId }, `MCP group's daily call pool has room again: ${groupId}`);
            }
        }
    }

    /**
     * Decide whether a successful call began after the pool was seen to be
     * exhausted, which is the only success that shows the pool has room again.
     *
     * The governor charges the pool before it runs the handler but writes the
     * record after the handler returns, so a call already in flight when the
     * pool ran out reports success afterwards without the pool having recovered.
     * Re-arming on that late success would send a second admin notification for
     * the same exhaustion, once for every call still running. The record is
     * stamped at completion, so subtracting the handler's duration gives the
     * moment the call started, just after the governor admitted it. An
     * unparseable stamp yields a NaN comparison and so no re-arm, which is the
     * safe direction for an alert meant to fire once.
     *
     * @param record - The successful call's audit record.
     * @param exhaustedAt - When this group's pool was first seen to refuse a call.
     * @returns True when the call started after that moment.
     */
    private startedAfter(record: IToolInvocationRecord, exhaustedAt: number): boolean {
        const completedAt = Date.parse(record.createdAt);
        return completedAt - record.durationMs > exhaustedAt;
    }

    /**
     * Write the `warn` entry and send the admin notification for one exhausted pool.
     *
     * @param groupId - The group whose pool ran out.
     * @param record - The first call the pool refused, named in the entry.
     * @returns Resolves once both have been attempted.
     */
    private async alert(groupId: string, record: IToolInvocationRecord): Promise<void> {
        const poolCallsPerDay = await this.readPoolLimit(groupId);
        const limitText = poolCallsPerDay === null ? 'its pooled daily limit' : `its pooled daily limit of ${poolCallsPerDay.toLocaleString('en-US')} calls`;
        const title = `MCP call pool used up: ${groupId}`;
        const body = `The ${groupId} group has used ${limitText}. Every call charged to it is refused until its 24-hour window resets. ` +
            'Raise the limit on the Tools tab of /system/mcp to let calls through now.';
        this.logger.warn(
            { groupId, poolCallsPerDay, tool: record.toolName, recordId: record.id },
            `MCP group's daily call pool is used up; calls charged to it are refused until its window resets: ${groupId}`
        );
        const notifications = this.resolveNotifications();
        if (notifications) {
            try {
                await notifications.notify({
                    category: MCP_POOL_EXHAUSTED_CATEGORY,
                    typeId: MCP_POOL_EXHAUSTED_CONTENT_TYPE,
                    ref: { title, body },
                    severity: 'warning',
                    firedBy: groupId,
                    data: { groupId, poolCallsPerDay }
                });
            } catch (error: unknown) {
                this.logger.warn({ err: error, groupId }, 'Failed to send the MCP pool notification');
            }
        }
    }

    /**
     * Read the group's pooled daily limit for the alert text.
     *
     * @param groupId - The group to read.
     * @returns The limit, or null when the group has none or it could not be read.
     */
    private async readPoolLimit(groupId: string): Promise<number | null> {
        let limit: number | null = null;
        try {
            limit = this.policies.policyFor(await this.policies.getPolicies(), groupId).limits.callsPerDayGroup;
        } catch (error: unknown) {
            this.logger.warn({ err: error, groupId }, 'Could not read the MCP group policy for the pool alert');
        }
        return limit;
    }
}
