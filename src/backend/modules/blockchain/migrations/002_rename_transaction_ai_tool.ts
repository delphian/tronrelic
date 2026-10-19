/**
 * @fileoverview Moves stored references from `tronrelic-get-transaction` to `blockchain-get-transaction`.
 *
 * The transaction lookup AI tool was renamed so it sits with the other
 * `blockchain-*` tools. Several stores record tools by name, and a name the
 * registry no longer knows is ignored or rejected rather than followed to the
 * new one. Without this migration an operator's choices about the tool would
 * be lost silently, and a saved prompt naming it would fail its next run.
 *
 * It rewrites four stores:
 *
 * - `ai-tools:tool-states` in `_kv`, the enabled or disabled switch per tool
 * - `ai-tools:policy-overrides` in `_kv`, per-tool policy set by an admin
 * - `toolAllowlist` on saved prompts in `module_ai-tools_prompts`
 * - grants to user groups in `module_mcp_tool_approvals`
 *
 * Query history and the invocation audit are left as they are, because they
 * record what happened under the old name.
 *
 * The AI tools module reads the two `_kv` entries once at startup and writes
 * its whole in-memory copy back whenever an admin changes a tool. Restart the
 * backend after running this, before changing any tool on `/system/ai-tools`,
 * or that write puts the old name back and drops the new one.
 *
 * It depends on the MCP module's `001_tool_approvals_group_id`, which adds
 * `groupId` to every grant and replaces the unique `{ toolName }` index, so
 * the grant rename below cannot run against the older schema.
 *
 * Collection, key, and tool names are written as literals on purpose: a
 * migration is a frozen record of an operation, so it must not drift if a
 * constant is later renamed.
 *
 * Idempotent. Every step matches only entries still carrying the old name, and
 * where an entry under the new name already exists it is kept and the old one
 * is removed rather than copied over it.
 *
 * @module backend/modules/blockchain/migrations/002_rename_transaction_ai_tool
 */

import type { IDatabaseService, IMigration, IMigrationContext } from '@/types';

/** The tool's name before the rename. */
const OLD_NAME = 'tronrelic-get-transaction';

/** The tool's name after the rename. */
const NEW_NAME = 'blockchain-get-transaction';

/** `_kv` entries holding one value per tool, keyed by tool name. */
const TOOL_KEYED_KV_ENTRIES = ['ai-tools:tool-states', 'ai-tools:policy-overrides'];

/** Saved prompts, whose `toolAllowlist` names the tools a run may use. */
const SAVED_PROMPTS_COLLECTION = 'module_ai-tools_prompts';

/** MCP tool grants, one document per tool and user group. */
const MCP_APPROVALS_COLLECTION = 'module_mcp_tool_approvals';

/**
 * Move one tool-keyed `_kv` map's entry from the old name to the new name.
 *
 * An admin's setting for the tool lives under its name, so leaving it behind
 * would reset the tool to its defaults. When the map already has an entry
 * under the new name, that entry was set after the rename deployed and is the
 * more recent choice, so it is kept and the old entry is only removed.
 *
 * @param database - Core database service, which reads and writes `_kv` without a prefix.
 * @param key - The `_kv` key holding the map.
 * @returns Resolves once the map is rewritten, or immediately when it holds no old entry.
 */
async function renameMapEntry(database: IDatabaseService, key: string): Promise<void> {
    const map = await database.get<Record<string, unknown>>(key);
    if (map && Object.prototype.hasOwnProperty.call(map, OLD_NAME)) {
        if (!Object.prototype.hasOwnProperty.call(map, NEW_NAME)) {
            map[NEW_NAME] = map[OLD_NAME];
        }
        delete map[OLD_NAME];
        await database.set(key, map);
    }
}

/**
 * Replace the old name in every saved prompt's tool allowlist.
 *
 * A saved prompt whose allowlist names a tool the registry does not know fails
 * the whole run before the model is called, so a scheduled prompt would stop
 * working. A list that already names the new tool only loses the old entry,
 * so the rename cannot leave the same tool listed twice.
 *
 * @param database - Core database service, used for raw collection access.
 * @returns Resolves once every matching prompt is rewritten.
 */
async function renameInSavedPrompts(database: IDatabaseService): Promise<void> {
    const prompts = database.getCollection<{ toolAllowlist: string[] }>(SAVED_PROMPTS_COLLECTION);

    await prompts.updateMany(
        { toolAllowlist: { $all: [OLD_NAME, NEW_NAME] } },
        { $pull: { toolAllowlist: OLD_NAME } }
    );
    await prompts.updateMany(
        { toolAllowlist: OLD_NAME },
        { $set: { 'toolAllowlist.$[name]': NEW_NAME } },
        { arrayFilters: [{ name: OLD_NAME }] }
    );
}

/**
 * Move every MCP grant of the tool to the new name.
 *
 * A grant names its tool, and the MCP module offers a group only the tools it
 * finds grants for, so an unmoved grant would hide the tool from that group.
 * Grants are unique on tool and group together, so a group already granted
 * the new name has its old grant deleted rather than renamed into a duplicate.
 * The capability fingerprint on each grant does not include the name and
 * stays valid.
 *
 * @param database - Core database service, used for raw collection access.
 * @returns Resolves once every grant of the old name is moved or removed.
 */
async function renameInMcpGrants(database: IDatabaseService): Promise<void> {
    const approvals = database.getCollection<{ toolName: string; groupId: string }>(MCP_APPROVALS_COLLECTION);

    const alreadyGranted = await approvals.distinct('groupId', { toolName: NEW_NAME });
    if (alreadyGranted.length > 0) {
        await approvals.deleteMany({ toolName: OLD_NAME, groupId: { $in: alreadyGranted } });
    }
    await approvals.updateMany({ toolName: OLD_NAME }, { $set: { toolName: NEW_NAME } });
}

export const migration: IMigration = {
    id: '002_rename_transaction_ai_tool',
    description:
        `Move stored references to the AI tool ${OLD_NAME} to its new name, ${NEW_NAME}: enabled state, ` +
        'policy overrides, saved-prompt tool allowlists, and MCP group grants. Restart the backend afterwards.',
    dependencies: [
        // Renaming a grant needs `groupId` present on every approval and the
        // retired unique `{ toolName }` index gone. Run this before the MCP
        // schema migration and the final `updateMany` in `renameInMcpGrants`
        // hits a duplicate key against an existing grant of the new name.
        'module:mcp:001_tool_approvals_group_id'
    ],

    /**
     * Rewrite each store that records the tool by name.
     *
     * @param context - Migration context exposing the core database service.
     * @returns Nothing; the changes live in MongoDB.
     */
    async up(context: IMigrationContext): Promise<void> {
        for (const key of TOOL_KEYED_KV_ENTRIES) {
            await renameMapEntry(context.database, key);
        }
        await renameInSavedPrompts(context.database);
        await renameInMcpGrants(context.database);
    }
};
