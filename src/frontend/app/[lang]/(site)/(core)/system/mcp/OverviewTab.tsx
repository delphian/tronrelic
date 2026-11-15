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
            {/* The description clients and registries show names what works
                without an account, so a grant change can make it wrong. The
                details and the fix are beside the Anonymous grants. */}
            {!status.serverDescription.matchesAnonymousGrants && (
                <div className="alert" role="status">
                    The server description no longer matches the tools granted to Anonymous. Open the Tools tab and choose
                    Anonymous to see what changed and how to update it.
                </div>
            )}
            <StatGrid size="sm">
                <StatTile size="sm" label="Tools served" value={status.servedToolCount} tone={status.servedToolCount > 0 ? 'primary' : 'neutral'} note="Granted to at least one group and switched on" />
                <StatTile size="sm" label="Needs re-approval" value={status.staleToolCount} tone={status.staleToolCount > 0 ? 'warning' : 'neutral'} note="Changed since granted; hidden until granted again on the Tools tab" />
                <StatTile size="sm" label="Accounts" value={status.memberCount} note={`Members of ${status.groupId}, which every account joins`} />
            </StatGrid>

            <McpUsagePanel initialUsage={initialUsage} groups={groups} />

            <Card>
                <Stack gap="sm">
                    <h3 className={styles.card_title}>Connection URLs</h3>
                    <p className={styles.intro}>
                        Share this URL. Anyone adds it as a custom connector in their AI client (Claude, Claude Desktop,
                        Claude Code, Cursor) and can call the tools granted to Anonymous straight away, without an account.
                        The first time their AI calls a tool that needs an account, the client opens TronRelic&apos;s sign-in
                        page; once they sign in, they can call the tools granted to their user groups. Nothing has to be
                        registered with the client&apos;s vendor.
                    </p>
                    <div className={styles.url_row}>
                        <code className={styles.url}>{status.resourceUrl}</code>
                        <CopyButton value={status.resourceUrl} size="sm" variant="ghost" label="Copy URL" />
                    </div>
                    <p className={styles.intro}>
                        An older address that only ever serves Anonymous tools and never asks anyone to sign in. It stays
                        for clients that were given it; there is no need to share it now.
                    </p>
                    <div className={styles.url_row}>
                        <code className={styles.url}>{status.publicUrl}</code>
                        <CopyButton value={status.publicUrl} size="sm" variant="ghost" label="Copy anonymous-only URL" />
                    </div>
                    <dl className={styles.facts}>
                        <dt>Who can connect</dt>
                        <dd>
                            Anyone. Every account joins <code>{status.groupId}</code> automatically, and accounts are managed on{' '}
                            <a className="link" href="/system/users?tab=users">/system/users</a>
                        </dd>
                        <dt>What they can call</dt>
                        <dd>
                            Without signing in, the tools granted to Anonymous. Signed in, the tools granted to any of their user
                            groups as well. Grant tools on the <a className="link" href="/system/mcp?tab=tools">Tools tab</a>.
                            Restricted tools go only to groups an admin has cleared for them, and never to Anonymous or{' '}
                            <code>{status.groupId}</code>
                        </dd>
                        <dt>Token issuer</dt>
                        <dd><code>{status.issuer}</code> — the sign-in server that issues the tokens a signed-in client sends</dd>
                    </dl>
                </Stack>
            </Card>
        </Stack>
    );
}
