import type { IMigration, IMigrationContext } from '@/types';
import type { IUserDocument, ITrafficOrigin } from '../database/IUserDocument.js';
import type { ITrafficEvent } from '../services/traffic.service.js';

// Inline constants and helpers from traffic.service.ts — migration files are
// compiled with `bundle: false`, so they cannot import runtime values from
// modules that are bundled into the main binary. Same pattern as migrations
// 006 and 009 for UserIdentityState. Keep in sync with traffic.service.ts.
const TRAFFIC_EVENTS_TABLE_NAME = 'traffic_events';

function pad(value: number, length: number): string {
    return String(value).padStart(length, '0');
}

function formatClickHouseDateTime64Utc(date: Date): string {
    return (
        `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)} ` +
        `${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}`
    );
}

function serializeTrafficEventForClickHouse(event: ITrafficEvent): Record<string, unknown> {
    return { ...event, timestamp: formatClickHouseDateTime64Utc(event.timestamp) };
}

// Inline string literal matching `UserIdentityState.Anonymous`. Migration
// files are compiled with `bundle: false`, which does not resolve the
// `@/types` path alias, so a runtime import of the enum breaks the
// scanner's dynamic import in production. Migrations 006 and 009 follow
// the same pattern. Keep this in sync with
// packages/types/src/user/IUserIdentityState.ts.
const IDENTITY_ANONYMOUS = 'anonymous';

/**
 * Phase 6 of the traffic-events split: prune empty Mongo `users` rows
 * left behind by the 2026-04-27 → 2026-04-30 orphan-row bug.
 *
 * **Why this migration exists.**
 * Commit `1fccdbe` (2026-04-27) moved identity-cookie minting from client
 * JavaScript into a Next.js middleware → backend bootstrap path. That
 * removed the implicit "client must run JavaScript" filter that previously
 * kept bots out of the `users` collection — every cookieless GET
 * (Googlebot, Slack unfurls, uptime probes) started persisting an empty
 * Mongo row. Phase 2 (PR #209, 2026-04-30) stopped the bleeding by
 * making `UserController.bootstrap` Mongo-read-only; Phase 4 (PR #210,
 * 2026-04-30 ~23:18 UTC) tightened the remaining write endpoints. This
 * migration cleans up the legacy orphans those phases stranded in the
 * collection — the residue that still makes the `/system/users`
 * new-users panel look noisy.
 *
 * **What this migration does.**
 *   1. Reads candidate orphan rows from MongoDB using a deliberately
 *      conservative predicate (anonymous identity state, no wallets,
 *      no groups, no engaged sessions, no preferences, no referral
 *      attribution, no merge-tombstone pointer, `createdAt` strictly
 *      before the Phase 4 prod-deploy cutoff).
 *   2. For each orphan with non-empty `activity.origin` data, writes a
 *      synthetic `bootstrap` event into ClickHouse `traffic_events`
 *      so first-touch attribution survives the prune. The synthetic
 *      event is timestamped at `user.createdAt`, since that is the
 *      best approximation of when the bootstrap actually happened
 *      (these rows were created during pre-Phase-2 bootstrap).
 *   3. Deletes the Mongo row. Insert-then-delete per row keeps the
 *      semantic invariant — an orphan's origin data is durable in CH
 *      before the row is removed. If the synthetic insert throws,
 *      the row is kept; the migration logs the failure and continues
 *      with the next orphan.
 *
 * **Conservatism is the point.** Every "engaged user" — anyone who
 * linked a wallet, set a preference, joined a group, started a session,
 * accumulated a referral, or has a merge tombstone — fails the
 * predicate by construction. The `createdAt < SAFETY_CUTOFF` belt
 * additionally fences off any post-Phase-4 row created by `ensureExists`
 * (e.g. a fresh-cookie user who issued a wallet challenge but never
 * signed) so the migration cannot retroactively delete intent it
 * doesn't fully understand.
 *
 * **Idempotency.** A successful run leaves no candidates for a future
 * run. Partial-failure semantics are best understood as "each row is
 * its own unit of work, neither side is transactional." `MigrationExecutor`
 * opens a mongoose session and wraps `migration.up()` in
 * `session.withTransaction()`, but the session is not threaded into
 * `IMigrationContext`, so native-driver `getCollection().deleteOne(...)`
 * calls do not participate — each delete commits independently the
 * moment it returns. ClickHouse inserts are likewise non-transactional
 * relative to MongoDB. If the migration crashes mid-loop, some rows are
 * deleted with their synthetic CH events durable, and the rest remain
 * pinned in Mongo with no synthetic event written. Retry is safe for
 * two reasons: already-deleted rows simply don't appear in the next
 * candidate scan, and the CH dedup query at the top filters out any
 * UUID that already carries a `bootstrap` event so a re-run cannot
 * duplicate-emit synthetic events for rows whose Mongo delete failed
 * after the CH insert succeeded.
 *
 * **ClickHouse required.** If `context.clickhouse` is undefined the
 * migration throws rather than silently pruning rows we cannot preserve
 * the origin data for. The operator should configure `CLICKHOUSE_HOST`
 * and retry. Phase 0 already deployed CH to prod, so in practice this
 * branch only fires in misconfigured dev environments.
 *
 * **Forward-only.** No rollback. The deleted rows had no engagement
 * signal; the synthetic CH events preserve whatever first-touch data
 * existed on `activity.origin`. If a regression somehow needed those
 * rows back, recovery is via Mongo backup, not via a `down()`.
 */
export const migration: IMigration = {
    id: '011_prune_empty_user_rows',
    description:
        'Phase 6 of the traffic-events split: prune empty Mongo users rows left ' +
        'behind by the 2026-04-27 → 2026-04-30 orphan-row bug. Per orphan with ' +
        'non-empty activity.origin, writes a synthetic ClickHouse bootstrap event ' +
        'so first-touch attribution survives, then deletes the Mongo row. ' +
        'Conservative predicate guarantees only never-engaged anonymous rows ' +
        'created before the Phase 4 prod deploy cutoff are eligible. Backs the ' +
        'final phase tracked in PLAN-traffic-events.md.',
    target: 'mongodb',
    // Depends on 012 (a higher-numbered migration) because 011's synthetic
    // backfill events now carry the Phase-5 `user_id` / `referral_code`
    // columns: those columns must exist before 011 inserts, or ClickHouse
    // rejects every row and the prune/backfill is silently skipped. The
    // dependency forces the topological sort to run 012 before 011 even
    // though id order would otherwise place 011 first.
    dependencies: [
        'module:user:010_create_traffic_events_table',
        'module:user:012_traffic_events_user_referral_columns'
    ],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            throw new Error(
                '[Migration 011] ClickHouse not configured — Phase 6 prune cannot ' +
                'run without a destination for activity.origin backfill. ' +
                'Configure CLICKHOUSE_HOST and retry.'
            );
        }

        // Skip the type parameter on getCollection — the migration filter
        // would otherwise force the literal `'anonymous'` constant through
        // the `UserIdentityState` enum gate, which TypeScript rejects under
        // string-valued enum nominal typing. Migrations 006 and 009 follow
        // the same pattern; documents are narrowed to `IUserDocument` after
        // the fetch via the `isEmptyUserRow` predicate.
        const users = context.database.getCollection('users');
        const ch = context.clickhouse;

        // Push the bulk-volume predicates into MongoDB so the index on
        // `identityState` and the array `$size` checks eliminate the vast
        // majority of non-orphans server-side. Three reviewers independently
        // flagged the prior `find().toArray()` materialize-everything pattern
        // as an OOM risk under bot-heavy incident windows. Real production
        // data here is bounded (~3 days of crawler traffic on a low-volume
        // site), but pushing the filter into the query is a strict
        // improvement and means the migration scales gracefully if the
        // orphan count surprises us.
        const candidates = (await users.find({
            identityState: IDENTITY_ANONYMOUS,
            createdAt: { $lt: SAFETY_CUTOFF },
            wallets: { $size: 0 },
            groups: { $size: 0 },
            'activity.sessionsCount': { $in: [null, 0] },
            'activity.pageViews': { $in: [null, 0] },
            $or: [
                { mergedInto: null },
                { mergedInto: { $exists: false } }
            ]
        }).toArray()) as unknown as IUserDocument[];

        // The JS post-filter handles the two predicates that don't
        // translate cleanly into Mongo: empty `preferences` object
        // (would require `$expr` + `$objectToArray`) and the referral
        // engagement check (Mongo's null-matches-missing semantics make
        // the clean expression awkward). It also keeps the wallets/groups/
        // activity invariants as a defensive belt — if the schema ever
        // drifts in production the JS predicate stays the source of truth.
        const orphans = candidates.filter(isEmptyUserRow);

        if (orphans.length === 0) {
            console.log('[Migration 011] No empty user rows to prune.');
            return;
        }

        const alreadyBackfilled = await fetchAlreadyBackfilledIds(
            ch,
            orphans.map(o => o.id)
        );

        let backfilled = 0;
        let pruned = 0;
        let skipped = 0;

        for (const user of orphans) {
            const origin = user.activity?.origin;

            if (origin && hasUsefulOrigin(origin) && !alreadyBackfilled.has(user.id)) {
                try {
                    // `waitForCommit` overrides the connection-level
                    // `wait_for_async_insert: 0` so the awaited promise
                    // really does mean "the row is durable in ClickHouse."
                    // Without it a flush failure would surface 30s later in
                    // the error poller — long after we'd already deleted
                    // the Mongo row that was the only other copy of this
                    // origin data.
                    await ch.insert(
                        TRAFFIC_EVENTS_TABLE_NAME,
                        [serializeTrafficEventForClickHouse(buildSyntheticEvent(user, origin))],
                        { waitForCommit: true }
                    );
                    backfilled++;
                } catch (error) {
                    console.warn(
                        `[Migration 011] Failed to backfill synthetic CH event for ${user.id} — keeping Mongo row:`,
                        error
                    );
                    skipped++;
                    continue;
                }
            }

            await users.deleteOne({ _id: user._id });
            pruned++;
        }

        console.log(
            `[Migration 011] Pruned ${pruned} empty user rows ` +
            `(backfilled ${backfilled} synthetic CH events, ` +
            `${alreadyBackfilled.size} already had a bootstrap event, ` +
            `${skipped} skipped due to CH backfill failure).`
        );
    }
};

/**
 * Hard cutoff that fences off the migration from rows created on or after
 * the Phase 4 production deploy (2026-04-30 ~23:18 UTC). Anything created
 * after this instant could have been written by `ensureExists` from a
 * legitimate write endpoint (`connectWallet`, `linkWallet`,
 * `issueWalletChallenge`, `updatePreferences`) and is excluded from prune
 * regardless of how empty the row looks.
 */
const SAFETY_CUTOFF = new Date('2026-05-01T00:00:00.000Z');

/**
 * Conservative empty-orphan predicate. Mirrors the wallets/groups/sessions
 * shape from the IUser taxonomy and treats every signal of engagement as
 * a hard "keep this row" bit. Combined with the Mongo-side filter
 * (`identityState: 'anonymous'`, `createdAt < SAFETY_CUTOFF`,
 * `mergedInto` unset/null), the resulting set is rows created during the
 * orphan-row window that never accumulated any cookie-validated
 * engagement.
 */
function isEmptyUserRow(user: IUserDocument): boolean {
    if (!Array.isArray(user.wallets) || user.wallets.length > 0) return false;
    if (!Array.isArray(user.groups) || user.groups.length > 0) return false;

    const activity = user.activity;
    if ((activity?.sessionsCount ?? 0) > 0) return false;
    if ((activity?.pageViews ?? 0) > 0) return false;

    const preferenceKeys = user.preferences ? Object.keys(user.preferences) : [];
    if (preferenceKeys.length > 0) return false;

    const referral = user.referral;
    if (referral && (referral.code || referral.referredBy)) return false;

    return true;
}

/**
 * `activity.origin` is set by migration 004 even for users with no
 * sessions (it backfills all-null defaults), so `origin != null` does
 * not by itself indicate analytic value. Require at least one populated
 * dimension before emitting a synthetic event — otherwise we'd write
 * empty rows into ClickHouse for no gain.
 */
function hasUsefulOrigin(origin: ITrafficOrigin): boolean {
    if (origin.referrerDomain || origin.landingPage || origin.country) return true;
    if (origin.device || origin.searchKeyword) return true;

    const utm = origin.utm;
    if (utm && (utm.source || utm.medium || utm.campaign || utm.term || utm.content)) {
        return true;
    }

    return false;
}

/**
 * Construct a synthetic `bootstrap` event from a pruned user's
 * `activity.origin`. The full HTTP context (raw `Referer`, `User-Agent`,
 * `Sec-CH-UA*`, `Sec-Fetch-*`) is unrecoverable for these legacy rows —
 * we only kept the dimensions migration 004 distilled. The header-
 * dependent columns are left `null` rather than fabricated.
 *
 * The preserved domain (e.g. `"twitter.com"`) is wrapped into a
 * scheme-prefixed URL form (`"https://twitter.com/"`) before going into
 * the `referer` column. This matters because Phase 3's first-touch
 * backfill in `UserService.startSession` reads this field through
 * `extractReferrerDomain`, which calls `new URL(value)` and returns
 * `null` for any bare-domain string. Without the scheme prefix the
 * synthetic event would still flow through CH but the next session
 * keyed off it would silently drop the referrer dimension —
 * defeating the migration's stated goal of preserving first-touch
 * attribution.
 *
 * `bot_class` is `null` because the classifier needs the raw UA string,
 * which legacy `activity.origin` did not preserve. That is fine — the
 * Phase 5 admin dashboard already treats `null` as "pre-classifier"
 * and surfaces it as a distinct bucket.
 */
function buildSyntheticEvent(user: IUserDocument, origin: ITrafficOrigin): ITrafficEvent {
    const utm = origin.utm;

    return {
        event_type: 'bootstrap',
        timestamp: user.createdAt,
        candidate_uid: user.id,
        // Legacy orphan rows predate Phase 5 attribution columns: the
        // visitor was anonymous (no Better Auth account) and carried no
        // captured referral. Both default to null.
        user_id: null,
        referral_code: null,

        path: origin.landingPage ?? '/',
        referer: origin.referrerDomain ? `https://${origin.referrerDomain}/` : null,
        original_referrer: null,

        user_agent: null,
        accept_language: null,

        country: origin.country ?? null,
        device: origin.device ?? 'unknown',
        bot_class: null,

        utm_source: utm?.source ?? null,
        utm_medium: utm?.medium ?? null,
        utm_campaign: utm?.campaign ?? null,
        utm_term: utm?.term ?? null,
        utm_content: utm?.content ?? null,

        sec_ch_ua: null,
        sec_ch_ua_mobile: null,
        sec_ch_ua_platform: null,
        sec_fetch_dest: null,
        sec_fetch_mode: null,
        sec_fetch_site: null
    };
}

/**
 * Return the set of candidate UUIDs that already carry a `bootstrap`
 * event in ClickHouse. Used to make the migration retry-safe: if a
 * previous run wrote synthetic events but failed before the Mongo
 * deletes committed (or vice-versa), the next attempt skips re-emitting
 * those rows and only completes the prune.
 *
 * On query failure, we log and proceed with an empty set — the worst
 * case is duplicate synthetic events on retry, which is recoverable
 * via an ad-hoc CH cleanup query and strictly preferable to leaving
 * orphans pinned in Mongo because the dedup query couldn't run.
 */
async function fetchAlreadyBackfilledIds(
    ch: NonNullable<IMigrationContext['clickhouse']>,
    candidateIds: string[]
): Promise<Set<string>> {
    const seen = new Set<string>();
    if (candidateIds.length === 0) return seen;

    try {
        const rows = await ch.query<{ candidate_uid: string }>(
            `SELECT DISTINCT candidate_uid AS candidate_uid
             FROM ${TRAFFIC_EVENTS_TABLE_NAME}
             WHERE event_type = {eventType:String}
               AND candidate_uid IN ({ids:Array(UUID)})`,
            { eventType: 'bootstrap', ids: candidateIds }
        );
        for (const row of rows) {
            seen.add(row.candidate_uid);
        }
    } catch (error) {
        console.warn(
            '[Migration 011] CH dedup query failed — proceeding without dedup ' +
            '(retry-on-failure may produce duplicate synthetic events):',
            error
        );
    }

    return seen;
}
