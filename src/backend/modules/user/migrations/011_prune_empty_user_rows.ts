import type { IMigration, IMigrationContext } from '@/types';
import { UserIdentityState } from '@/types';
import type { IUserDocument, ITrafficOrigin } from '../database/IUserDocument.js';
import {
    TRAFFIC_EVENTS_TABLE_NAME,
    serializeTrafficEventForClickHouse,
    type ITrafficEvent
} from '../services/traffic.service.js';

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
 * run. If the migration fails partway through, the Mongo transaction
 * rolls back the `deleteOne` calls but the ClickHouse inserts are
 * already durable — `wait_for_async_insert: 0` means CH does not
 * participate in the Mongo transaction. To prevent duplicate synthetic
 * events on retry, we query CH at the top for any candidate UUID that
 * already carries a `bootstrap` event and skip backfill for those rows
 * (the prune still runs).
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
    dependencies: ['module:user:010_create_traffic_events_table'],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            throw new Error(
                '[Migration 011] ClickHouse not configured — Phase 6 prune cannot ' +
                'run without a destination for activity.origin backfill. ' +
                'Configure CLICKHOUSE_HOST and retry.'
            );
        }

        const users = context.database.getCollection<IUserDocument>('users');
        const ch = context.clickhouse;

        const candidates = await users.find({
            identityState: UserIdentityState.Anonymous,
            createdAt: { $lt: SAFETY_CUTOFF },
            $or: [
                { mergedInto: null },
                { mergedInto: { $exists: false } }
            ]
        }).toArray();

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
                    await ch.insert(
                        TRAFFIC_EVENTS_TABLE_NAME,
                        [serializeTrafficEventForClickHouse(buildSyntheticEvent(user, origin))]
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
 * we only kept the dimensions migration 004 distilled. We map the
 * domain into `referer` (a domain is a valid Referer URL even if real
 * traffic typically carries the full path) and leave header-dependent
 * columns as `null` rather than fabricating values.
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

        path: origin.landingPage ?? '/',
        referer: origin.referrerDomain ?? null,
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
