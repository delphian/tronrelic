/**
 * @fileoverview Assign existing MCP tool approvals to the `mcp-users` group.
 *
 * MCP tool approvals used to be one document per tool, meaning "every MCP
 * user may call this tool". They are now one document per tool and user group,
 * so an admin can grant different tools to different groups. Every approval
 * written before that change meant `mcp-users`, which is what this migration
 * records on them.
 *
 * It also drops the old unique index on `toolName` alone. The service creates
 * the replacement unique index on `{ toolName, groupId }` at startup, but the
 * old one would refuse a second group's grant for any tool already approved.
 *
 * Until this runs, the service ignores approvals without a group id, so tools
 * approved before the upgrade are hidden from MCP rather than served on terms
 * nobody chose. Run it from `/system/database` after deploying.
 *
 * Collection, index, and group names are written as literals on purpose: a
 * migration is a frozen record of an operation, so it must not drift if a
 * constant is later renamed.
 *
 * Idempotent. The backfill matches only documents missing `groupId`, and the
 * index drop tolerates the index already being gone.
 */

import type { IMigration, IMigrationContext } from '@/types';

/** The MCP tool approvals collection. */
const COLLECTION = 'module_mcp_tool_approvals';

/** Auto-generated name of the retired unique `{ toolName: 1 }` index. */
const RETIRED_INDEX = 'toolName_1';

/** The group every pre-upgrade approval was for. */
const GATE_GROUP_ID = 'mcp-users';

/**
 * Decide whether a `dropIndex` failure only means there was nothing to drop,
 * so the migration can treat it as success and still surface real failures.
 *
 * The stable numeric codes are tested first, IndexNotFound (27) and
 * NamespaceNotFound (26), because the server's message wording changes across
 * versions; the message match is a fallback for drivers that give no code.
 *
 * @param error - What `dropIndex` threw.
 * @returns True when the index or its collection was already absent.
 */
function isNothingToDrop(error: unknown): boolean {
    const details = error as { code?: number; codeName?: string } | null;
    const message = error instanceof Error ? error.message : String(error);
    return details?.code === 27
        || details?.code === 26
        || details?.codeName === 'IndexNotFound'
        || details?.codeName === 'NamespaceNotFound'
        || /index not found/i.test(message)
        || /ns not found/i.test(message);
}

export const migration: IMigration = {
    id: '001_tool_approvals_group_id',
    description: 'Assign pre-existing MCP tool approvals to the mcp-users group and drop the retired unique { toolName } index.',
    dependencies: [],

    /**
     * Stamp every approval that has no group with `mcp-users`, then drop the
     * index that allowed only one approval per tool.
     *
     * @param context - Migration context exposing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection(COLLECTION);

        await collection.updateMany(
            { groupId: { $exists: false } },
            { $set: { groupId: GATE_GROUP_ID } }
        );

        // dropIndex throws when the index does not exist (fresh deploys never
        // create it; a re-run already dropped it) and when the collection does
        // not exist yet. Those are success states for this migration. Any other
        // failure (permissions, stepdown, transient) propagates, because a
        // retained index would refuse every second group's grant for a tool.
        try {
            await collection.dropIndex(RETIRED_INDEX);
        } catch (error) {
            if (!isNothingToDrop(error)) {
                throw error;
            }
        }
    }
};
