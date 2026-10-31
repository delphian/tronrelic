import type { IMigration, IMigrationContext } from '@/types';

/** Collection the old automated-network list lived in. */
const LEGACY_COLLECTION = 'module_traffic_bot_networks';

/** Collection the bot rules live in. Spelled out so the migration does not depend on service code. */
const RULES_COLLECTION = 'module_traffic_bot_rules';

/**
 * One entry of the old automated-network list.
 */
interface ILegacyBotNetwork {
    /** The listed network number. */
    asn: number;
    /** The operator's note, or null. */
    note?: string | null;
    /** When the network was listed. */
    addedAt?: Date;
}

/**
 * Move each entry of the automated-network list into a bot rule.
 *
 * **Why this migration exists**
 *
 * The automated-network list labeled every human-looking event from a listed
 * network as `bot_other`. Bot rules replace it with conditions an operator can
 * combine, and the list's service and routes were removed. Without this move,
 * networks an operator had already confirmed as automated would silently start
 * counting as human again.
 *
 * Each entry becomes one active rule with a single network condition, label
 * `bot_other`, and `label` mode, which is exactly what the list did. Its id is
 * derived from the network number (`migrated-asn-<asn>`), and the write is an
 * upsert on that id, so a re-run creates no duplicates and does not overwrite a
 * rule an operator has since edited. The legacy collection is dropped after the
 * copy. Forward-only.
 *
 * Run migration 021 first, so the events these rules match can be recorded with
 * their rule id. "Run all pending" runs them in that order.
 */
export const migration: IMigration = {
    id: '022_move_bot_networks_to_bot_rules',
    description:
        'Move each entry of module_traffic_bot_networks into an active bot rule in module_traffic_bot_rules ' +
        '(one network condition, label bot_other, label mode), then drop the legacy collection. Idempotent.',
    dependencies: [],

    /**
     * Copy the legacy entries into rules and drop the legacy collection.
     *
     * @param context - Migration context; only `database` is used.
     * @returns Resolves once the entries are copied and the collection dropped.
     */
    async up(context: IMigrationContext): Promise<void> {
        const legacy = context.database.getCollection<ILegacyBotNetwork>(LEGACY_COLLECTION);
        const rules = context.database.getCollection(RULES_COLLECTION);

        // `find` on a missing collection returns an empty cursor, so this read
        // doubles as the existence check.
        const entries = await legacy.find({}).toArray();
        let moved = 0;
        for (const entry of entries) {
            const addedAt = entry.addedAt instanceof Date ? entry.addedAt : new Date();
            const result = await rules.updateOne(
                { id: `migrated-asn-${entry.asn}` },
                {
                    $setOnInsert: {
                        id: `migrated-asn-${entry.asn}`,
                        name: `Network AS${entry.asn}`,
                        note: entry.note ?? null,
                        conditions: { asns: [entry.asn] },
                        label: 'bot_other',
                        mode: 'label',
                        enabled: true,
                        status: 'active',
                        source: 'migration',
                        evidence: null,
                        expiresAt: null,
                        createdAt: addedAt,
                        updatedAt: addedAt
                    }
                },
                { upsert: true }
            );
            if (result.upsertedCount > 0) {
                moved += 1;
            }
        }

        if (entries.length > 0) {
            try {
                await legacy.drop();
            } catch (error) {
                const code = (error as { code?: number } | undefined)?.code;
                const message = error instanceof Error ? error.message : String(error);
                // Code 26 — NamespaceNotFound: a prior run already dropped it.
                if (code !== 26 && !/ns not found/i.test(message)) {
                    throw error;
                }
            }
        }

        console.log(
            `[Migration 022] Moved ${moved} automated network(s) into bot rules` +
            (entries.length > 0 ? `; dropped ${LEGACY_COLLECTION}` : ' (legacy collection absent)')
        );
    }
};
