'use client';

/**
 * @fileoverview Overview tab of /system/mcp: how callers connect to each
 * endpoint, the headline counts an operator checks first, and the usage view.
 */

import type { IMcpGroup, IMcpStatus, IMcpUsageReport } from '@/types';
import { Card } from '../../../../../../components/ui/Card';
import { Stack } from '../../../../../../components/layout';
import { StatGrid, StatTile } from '../../../../../../components/ui/StatTile';
import { CopyButton } from '../../../../../../components/ui/CopyButton';
import { McpUsagePanel } from './McpUsagePanel';
import styles from './page.module.scss';

/**
 * Props for {@link OverviewTab}.
 */
interface IOverviewTabProps {
    /** Current status; null when it could not be loaded. */
    status: IMcpStatus | null;
    /** The 24-hour usage report fetched during server rendering; null when the fetch failed. */
    initialUsage: IMcpUsageReport | null;
    /** The groups, so the usage view can show names rather than ids. */
    groups: IMcpGroup[];
}

/**
 * Render the overview.
 *
 * @param props - {@link IOverviewTabProps}.
 * @returns The overview panel.
 */
export function OverviewTab({ status, initialUsage, groups }: IOverviewTabProps) {
    return status === null ? (
        <div className="alert" role="alert">The MCP status could not be loaded. Refresh the page to try again.</div>
    ) : (
        <Stack gap="md">
            <StatGrid size="sm">
                <StatTile size="sm" label="Tools served" value={status.servedToolCount} tone={status.servedToolCount > 0 ? 'primary' : 'neutral'} note="Granted to at least one group and enabled" />
                <StatTile size="sm" label="Needs re-approval" value={status.staleToolCount} tone={status.staleToolCount > 0 ? 'warning' : 'neutral'} note="Capability changed since approval" />
                <StatTile size="sm" label="Group members" value={status.memberCount} note={`Members of ${status.groupId}`} />
            </StatGrid>

            <McpUsagePanel initialUsage={initialUsage} groups={groups} />

            <Card>
                <Stack gap="sm">
                    <h3 className={styles.card_title}>Connection URLs</h3>
                    <p className={styles.intro}>
                        A member adds the signed-in URL as a custom connector in their AI client (Claude, Claude Desktop,
                        Claude Code, Cursor). The client opens TronRelic&apos;s sign-in page, the member approves it, and
                        the client can then call the tools served here. Nothing has to be registered with the client&apos;s vendor.
                    </p>
                    <div className={styles.url_row}>
                        <code className={styles.url}>{status.resourceUrl}</code>
                        <CopyButton value={status.resourceUrl} size="sm" variant="ghost" label="Copy signed-in URL" />
                    </div>
                    <p className={styles.intro}>
                        Anyone can connect to the public URL without signing in. It serves only the tools granted to the
                        Anonymous group on the Tools tab, under that group&apos;s limits, and serves nothing until you grant one.
                    </p>
                    <div className={styles.url_row}>
                        <code className={styles.url}>{status.publicUrl}</code>
                        <CopyButton value={status.publicUrl} size="sm" variant="ghost" label="Copy public URL" />
                    </div>
                    <dl className={styles.facts}>
                        <dt>Token issuer</dt>
                        <dd><code>{status.issuer}</code></dd>
                        <dt>Who can connect</dt>
                        <dd>Members of the <code>{status.groupId}</code> group, managed on /system/users, at the signed-in URL; anyone at the public URL</dd>
                        <dt>What they can call</dt>
                        <dd>The tools an admin grants to one of their user groups on the Tools tab, or to Anonymous for the public URL. Restricted tools go only to groups an admin has cleared for them, and never to Anonymous</dd>
                    </dl>
                </Stack>
            </Card>
        </Stack>
    );
}
