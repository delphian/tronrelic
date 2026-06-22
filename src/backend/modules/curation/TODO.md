# Curation Module — Roadmap

The forward backlog for the curation module. Curation was extracted from `ai-tools` into its own module so it can become the **single, centralized human-review pipeline** every consumer uses — AI-driven or not. These items are where that independent ownership pays off: each would previously have meant growing an unrelated module, and now lands in the one module whose sole responsibility is manual review.

Honest caveat: most items below were *technically* possible before the extraction. The isolation does not unlock new capability so much as remove the disincentive — a curation-owned schema change, admin sub-surface, or scheduler job is now a single-responsibility edit rather than a layering violation in `ai-tools`.

Ordering is rough priority, highest-leverage first. Each item notes the **why** and rough **scope**.

## 1. Consolidate the plugin-private review queues

The strongest near-term move: retire the bespoke review queues that predate the central one, proving the non-AI path end-to-end and deleting duplicated UI.

| Item | Why | Scope |
|------|-----|-------|
| Port `trp-address-labels` review queue | It ships its own human-moderation flow for proposed address labels (`src/backend/routes/review.ts` + `ReviewTab.tsx`) with no AI involvement — the canonical "second consumer" shape | Register `ICurationType` `address-labels:proposal`, `hold()` proposals, delete the bespoke route + tab |
| Reconcile the dual-surface drift | `trp-x-poster` / `trp-telegram-bot` keep their own History tabs; deciding from one leaves the central envelope `pending` (noted in [system-curation.md](../../../../docs/system/system-curation.md)) | Make the plugin History surfaces read-only mirrors of the central queue, or remove them |

## 2. Queue management at scale

The queue is an unfiltered newest-first list today — fine for a handful of holds, painful beyond. These need curation-owned controller + schema growth.

| Item | Why | Scope |
|------|-----|-------|
| Filtering / search / pagination | Find by `typeId`, `providerId`, `source`, status, date instead of scrolling one list | Controller query params + indexes (the `{ typeId, status }` index already exists) |
| Bulk decisions | "Approve all from x-poster" — one-at-a-time does not scale to a backlog | Batch approve/reject endpoint; reuse the per-item atomic gate per id |
| Multi-curator claiming / assignment | Two reviewers should not both action the same item; "who is reviewing what" | Add `assignedTo` / `claimedAt` to the envelope; claim/release endpoints |
| Expiry / SLA / escalation | A held effect should not wait forever; stale holds auto-reject or escalate | **Curation-owned scheduler job** (the module registers none today) sweeping by `createdAt`; this is the clearest "now it can" item — the cron belongs here, not in `ai-tools` |
| Pending-queue digest | Periodic summary of what awaits review, beyond the per-hold toast | Scheduler job + the existing `curation.held` notification category (or a new digest category) |

## 3. Type contract & editing

The design doc explicitly defers rich editing — today every item routes through one generic body-text editor.

| Item | Why | Scope |
|------|-----|-------|
| Per-type editor registry | A tweet composer with a live char count, an image regen prompt, a label-evidence panel — richer than one neutral textarea | Frontend editor registry keyed by `typeId`; the write still flows through the type's `applyEdit` so the plugin keeps validation ownership |
| Structured diff on edits | Show before/after for an edit-type hold so a curator sees exactly what changed | Extend `IContentDescriptor` / the edit path with a diff shape |

## 4. Governance & routing

| Item | Why | Scope |
|------|-----|-------|
| Per-type curator authorization | Any admin can decide any held item today; some types want a narrower group ("only `social` decides `x-poster:tweet`") | A `requiresGroups`-style gate on `ICurationType`, enforced in the decision path against `'user-groups'` |
| Additional notification channels | `curation.held` is toast-only; an email digest or a Slack/webhook approve-from-outside flow widens who can clear the queue | New channels on the curation-owned notification category; an external-decision callback that re-enters `approve`/`reject` |

## Non-goals (for now)

- Replacing a provider's right to own its payload and `applyEdit` validation — core stays payload-agnostic by design.
- A generic plugin-component injection editor — deliberately deferred in favor of the neutral editor + the future per-type registry above.
