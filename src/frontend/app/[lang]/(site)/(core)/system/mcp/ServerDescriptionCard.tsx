'use client';

/**
 * @fileoverview The server description card on the Tools tab of /system/mcp,
 * shown while the Anonymous group is being managed.
 *
 * AI clients, the Server Card, and the MCP Registry listing all show one
 * sentence describing the server, and that sentence names what works without
 * an account. It is fixed text in code, while the anonymous grants change
 * here, so the card sits beside those grants and says when the two no longer
 * match and what to change.
 */

import type { IMcpServerDescriptionStatus } from '@/types';
import { Card } from '../../../../../../components/ui/Card';
import { Stack } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import styles from './page.module.scss';

/**
 * Props for {@link ServerDescriptionCard}.
 */
interface IServerDescriptionCardProps {
    /** The description beside the anonymous tools it was written for and those served now. */
    status: IMcpServerDescriptionStatus;
}

/**
 * List tool names as badges, or say there are none.
 *
 * @param names - The tool names.
 * @returns The badge row.
 */
function toolBadges(names: string[]) {
    return (
        <div className={styles.badge_row}>
            {names.length === 0
                ? <span className={styles.tool_meta}>None</span>
                : names.map(name => <Badge key={name} tone="neutral" size="xs">{name}</Badge>)}
        </div>
    );
}

/**
 * Render the server description, the tools it was written for, the tools
 * served to Anonymous now, and what to do when they differ.
 *
 * @param props - {@link IServerDescriptionCardProps}.
 * @returns The card.
 */
export function ServerDescriptionCard({ status }: IServerDescriptionCardProps) {
    return (
        <Card>
            <Stack gap="sm">
                <h3 className={styles.card_title}>Server description</h3>
                <p className={styles.intro}>
                    AI clients, the Server Card, and the MCP Registry listing show this sentence. It says what works without
                    an account, so it has to match the tools granted to Anonymous. Changing a grant here does not change it.
                </p>
                <dl className={styles.facts}>
                    <dt>Description</dt>
                    <dd>{status.description}</dd>
                    <dt>Version</dt>
                    <dd><code>{status.version}</code></dd>
                    <dt>Written for</dt>
                    <dd>{toolBadges(status.describedAnonymousTools)}</dd>
                    <dt>Served to Anonymous now</dt>
                    <dd>{toolBadges(status.servedAnonymousTools)}</dd>
                </dl>
                {status.matchesAnonymousGrants ? (
                    <div><Badge tone="success" size="sm">Matches the Anonymous grants</Badge></div>
                ) : (
                    <div className="alert" role="status">
                        The description no longer matches the tools granted to Anonymous. Rewrite <code>DESCRIPTION</code> and
                        update <code>DESCRIBED_ANONYMOUS_TOOLS</code> in <code>src/backend/modules/mcp/services/buildMcpServerIdentity.ts</code>,
                        bump <code>MCP_SERVER_VERSION</code>, and deploy. Then put the same sentence and version in
                        <code> configs/mcp-registry/server.json</code> in the ops repository and republish the MCP Registry listing.
                    </div>
                )}
            </Stack>
        </Card>
    );
}
