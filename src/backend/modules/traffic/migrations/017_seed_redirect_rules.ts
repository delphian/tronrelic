import type { IMigration, IMigrationContext } from '@/types';

/**
 * Seed the admin-managed redirect collection with the known legacy-URL set.
 *
 * **Why this migration exists**
 *
 * Redirect rules moved out of the hardcoded middleware bundle into
 * `module_traffic_redirects`, where the edge middleware reads them and
 * operators edit them without a deploy. That left the collection empty, so on
 * cutover the previously-hardcoded redirects would go dead until re-entered by
 * hand. This migration back-fills them — the 17 rules lifted verbatim from the
 * former middleware `REDIRECT_RULES` array plus 3 fixes for dead 404s the SEO
 * audit surfaced (`/tron-forum`, `/blockchain*`, `/a/*`).
 *
 * Seeding is a one-time data load, not a return to bundle-hardcoded redirects:
 * every seeded rule is fully admin-editable/deletable afterward and the
 * middleware still reads the live DB feed, so adding future redirects never
 * needs a deploy.
 *
 * **Idempotent.** Each rule upserts by `pattern` with `$setOnInsert`, so a
 * re-run inserts nothing and an operator's later edit to a seeded rule is never
 * clobbered. New patterns an operator added by hand are untouched.
 *
 * All seeded rules are prefix matches issuing a 301, matching the former
 * middleware behavior (a prefix rule also catches sub-paths, e.g. `/blockchain`
 * absorbs `/blockchain/account?address=…`).
 */

/** Physical collection the redirect service reads/writes. */
const COLLECTION_NAME = 'module_traffic_redirects';

/**
 * One seed rule. All seeds share `isPrefix: true`, `permanent: true`,
 * `enabled: true`; only the paths and provenance note vary.
 */
interface ISeedRedirect {
    /** Source path to match. */
    pattern: string;
    /** Destination path. */
    destination: string;
    /** Provenance note surfaced in the admin table. */
    note: string;
}

/**
 * The legacy redirect set. First block is restored verbatim from the middleware
 * `REDIRECT_RULES` array; second block is the audit's dead-404 fixes.
 */
const SEED_RULES: ReadonlyArray<ISeedRedirect> = [
    // Restored from the former hardcoded middleware REDIRECT_RULES array.
    { pattern: '/rent-tron-energy', destination: '/resource-markets', note: 'Legacy resource-markets landing path' },
    { pattern: '/lp/rm', destination: '/resource-markets', note: 'Legacy resource-markets landing path' },
    { pattern: '/tron-trx-energy-fee-calculator', destination: '/tools', note: 'Legacy tool path' },
    { pattern: '/tools/staking-calculator', destination: '/tools', note: 'Legacy tool path' },
    { pattern: '/tools/tronmoji', destination: '/tools', note: 'Legacy tool path' },
    { pattern: '/tools/tron-custom-address-generator', destination: '/tools', note: 'Legacy tool path' },
    { pattern: '/tools/signature-verification', destination: '/tools', note: 'Legacy tool path' },
    { pattern: '/tools/hex-to-base58check', destination: '/tools', note: 'Legacy tool path' },
    { pattern: '/tools/base58check-to-hex', destination: '/tools', note: 'Legacy tool path' },
    { pattern: '/tron-dex', destination: '/articles', note: 'Legacy article slug' },
    { pattern: '/tron-latest-trc10-tokens', destination: '/articles', note: 'Legacy article slug' },
    { pattern: '/tron-latest-trc10-exchanges', destination: '/articles', note: 'Legacy article slug' },
    { pattern: '/tron-node-setup-guide', destination: '/articles', note: 'Legacy article slug' },
    { pattern: '/tron-bandwidth-vs-energy', destination: '/articles', note: 'Legacy article slug' },
    { pattern: '/tron-delegated-proof-of-stake', destination: '/articles', note: 'Legacy article slug' },
    { pattern: '/tron-trc10-token', destination: '/articles', note: 'Legacy article slug' },
    { pattern: '/tron-super-representatives', destination: '/articles', note: 'Legacy article slug' },

    // Dead-404 fixes from the SEO audit. `/blockchain` (prefix) absorbs the old
    // `/blockchain/account` explorer and its `?address=` variants; `/a` (prefix)
    // absorbs the removed per-address `/a/{address}` pages.
    { pattern: '/tron-forum', destination: '/forum', note: 'Renamed forum section' },
    { pattern: '/blockchain', destination: '/', note: 'Removed blockchain/account explorer' },
    { pattern: '/a', destination: '/', note: 'Removed per-address account pages' }
];

/**
 * Idempotent seed of the legacy redirect rules.
 */
export const migration: IMigration = {
    id: '017_seed_redirect_rules',
    description:
        'Seed module_traffic_redirects with the 17 legacy middleware redirects plus 3 audit 404-fixes ' +
        '(prefix, 301), idempotently via $setOnInsert so admin edits are never clobbered.',
    dependencies: [],

    /**
     * Upsert each seed rule by `pattern`. `$setOnInsert` inserts only when the
     * pattern is absent, so re-runs are no-ops and any operator edit to a seeded
     * rule survives.
     *
     * @param context - Migration context providing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection(COLLECTION_NAME);
        const now = new Date();
        let inserted = 0;

        for (const rule of SEED_RULES) {
            const result = await collection.updateOne(
                { pattern: rule.pattern },
                {
                    $setOnInsert: {
                        pattern: rule.pattern,
                        destination: rule.destination,
                        isPrefix: true,
                        permanent: true,
                        enabled: true,
                        notes: rule.note,
                        createdAt: now,
                        updatedAt: now
                    }
                },
                { upsert: true }
            );
            if (result.upsertedCount > 0) {
                inserted++;
            }
        }

        console.log(
            `[Migration] Seeded ${inserted} redirect rule(s) into ${COLLECTION_NAME} ` +
            `(${SEED_RULES.length - inserted} already present)`
        );
    }
};
