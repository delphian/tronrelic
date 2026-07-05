# Content Routing

**Status: partially implemented.** The router primitive ships in core and `@delphian/tronrelic-types`: `IContentRouter` (published `'content-router'`, a peer of the content-type and hook registries), the governed `IContentClassification` vocabulary (`egress`/`audience` with ordered levels), the `IContentSink` contract (`accepts`/`reach`/`deliver`), the classification gate as a seam (containment shape and direction enforced; `policy.permits` an allow-all stub), and the governed typed-key registry — the descriptor's `fields` slot is the typed `IContentFields` map (read via `readContentField`, an undeclared-key read is a compile error), with the human-readable facts table moved to a `details` slot. It is introspected read-only at `/system/content-router`. Curation registers a gate sink (`curation:gate`, `accepts: []`, reach `{ internal, admin }`) and notifications registers a sink per channel and routes its candidate matching through the router (`accepts ⊆ present`), retiring its private `present ⊆ accepts` check — each family keeping its own delivery (curation holds for review; notifications resolves recipients and fans out, and a channel that matches but cannot render refuses observably at delivery). The sink contract now carries a `kind` (`gate` / `delivery` / `publish`), and curation additionally acts as the interactive **mandated-subset selector**: a curation type that opts in (`publishesToDestinations`) surfaces the gate-admitted `publish` sinks at review, and the curator selects which fire on approval — enqueued into the durable `syndication` outbox with each destination's live outcome overlaid (see [Selecting the mandated subset at the gate](#selecting-the-mandated-subset-at-the-gate)). The credential-free core `core:internal-publish` sink ships as the first selectable destination, and `trp-telegram-bot` ships the first concrete *external* publish sink — one per admin-allowlisted Telegram channel (`reach { external, public }`, `accepts ['body']`), registered on the router through `context.services.watch('content-router')` and delivered through the durable syndication relay. **Now shipped:** the `syndication` publish sink family and its durable-delivery stack — transactional outbox, retrying async relay, idempotent receiver keyed `(originId, sinkId)`, and dead-letter — owned by the `syndication` core module and published `'syndication'`; curation enqueues approved publish legs into it (committed with the decision) instead of delivering inline best-effort, and overlays live leg state onto its destination outcomes on read. The prescriptive delivery contract — the at-least-once-plus-idempotency guarantee, eventual outcomes, and the curation integration — is [system-syndication.md](./system-syndication.md); the implementation specifics (outbox schema, relay loop, backoff curve, dead-letter) are the [syndication module README](../../src/backend/modules/syndication/README.md). **Still proposed:** the authorization/security policy behind the gate (today an allow-all stub). The [content-types registry](./system-content-types.md), [curation](./system-curation.md), and [notifications](./system-notifications.md) exist today.

One model for every pipeline that consumes a content type: **each consumer is a sink family over a single router**. Curation, notifications, and external publishing are not three architectures — they are three kinds of sink.

## Why This Matters

Without a shared router, every pipeline that handles provider content reinvents its own consumer wiring: curation would hard-wire one `onApprove` effect, notifications its own channel matrix, a "post this to Twitter, Telegram, and Reddit" feature a third bespoke fan-out. Each re-solves the same problem — match a content type to the things that can act on it — unevenly, and none lets an operator **redirect** or **multi-direct** a content type without a code change. That coupling is what this router removes.

The fix decouples a content type from its destinations. A content type declares *what it is* and *how sensitive it is*; sinks declare *what they can render* and *how far they expose it*; an admin binds the two as policy. Then a hypothetical `tronrelic:mediaPost` reaches Twitter, Telegram, and Reddit because an operator selected those destinations — not because the type, or any sink, was edited to know about the others. Because destinations are policy data, a later authorization pass can let an operator cut all external egress during an incident, or stop a category from going public, without shipping code. The same router serves human review (a **gate sink**), user delivery (a **delivery sink**), and external publishing (a **publish sink**); reception differs, routing does not.

## How It Works

### Roles over a canonical IR

The flow is `originator → (mutator) → router → sink`. An **originator** holds or fires content by reference. The platform resolves the content type, authorizes and computes the eligible sinks, and dispatches. The [`IContentDescriptor`](./system-content-types.md) is the canonical **intermediate representation** — a deliberately minimal four renderable slots (`title` / `body` / `media` / `details`), plus the governed typed `fields` escape hatch (below), that decouples N content types from M sinks through one thin interface. That minimalism is the **narrow-waist** model (the same shape as IP in the network stack, or the CloudEvents envelope): the thin waist is the mechanism that turns N×M bespoke adapters into N+M, not a shortcut. `describe()` is the front-end (payload → IR, owned by the content type); a sink's adapter is the back-end (IR → wire), a per-sink **Message Translator** / anti-corruption layer owned by the sink. Neither reaches across the seam — that is what lets a sink act on a content type without knowing its `typeId`.

Keep the IR minimal on purpose, and keep it minimal over time. The classic failure of a canonical data model is the opposite of too-little: it accretes optional fields to satisfy each new participant until it is a lowest-common-denominator superset that couples everyone to one central schema no one can change safely. This descriptor resists that by staying four slots wide. The sanctioned way to carry more is a governed `fields` entry (below) or a registered edge translator — never a fifth top-level slot bolted on for one sink. A reviewer who sees the descriptor growing should read it as a smell, not progress.

Computing a *set* of eligible sinks and delivering to all of them is EIP's **Recipient List** (a **Dynamic Router** once sinks self-register their eligibility), not a single-destination Content-Based Router — which routes each message to exactly one of several destinations. "Router" here is shorthand for that fan-out dispatcher: the pattern is Recipient List / Dynamic Router, and the contract below is written to it, not to a router that picks one branch.

### Classification, authorization, then structural routing

Three concerns the design keeps separate so the routing layer stays a routing layer. Merging them into a single sink-owned predicate is the trap — a sink's `eligible(intent)` deciding its own egress. That merge puts the decision in the wrong place three ways. **It scatters the judgment**: every plugin sink carries its own copy of "may this leave the building," so a question that deserves one answer has as many answers as there are sinks. **It removes the operator's lever**: an admin cannot redirect a class of content — "nothing external for now," "this category never goes public" — without editing sink code. **It welds reclassification to code**: changing how sensitive a content type is forces edits to sinks that never owned the judgment. Lift the decision out of the sink and the sink goes back to declaring only what it structurally renders and how far it sits from the building's edge.

Security is not what this layer is for. Separating these concerns establishes a clean **seam** where authorization belongs and then leaves it mostly empty: the router ships the seam and the vocabulary, and the policy and enforcement that occupy it are a later pass (see [open questions](#decisions-and-open-questions)). What this layer fixes is the *shape*, so that pass attaches between the seams instead of rearchitecting them.

**Classification — the label.** `content.classification: IContentClassification` is `{ egress, audience }`. `egress ∈ internal < user < external` says how far the content may be exposed; `audience ∈ admin < user < public` says how broadly. It is a *ceiling* — the maximum exposure the content permits — and it is data about the content, never a destination.

**Reach — the sink's position.** `sink.reach: IContentClassification` is the exposure a sink *causes*: a Twitter sink is `{ external, public }`, a toast `{ user, user }`, an internal audit sink `{ internal, admin }`. It is data the sink declares, never a predicate the sink runs.

**The gate — the seam.** A core, admin-governed step that runs *before* routing. For content `C` and sink `S` it admits `S` only when `S`'s reach stays within `C`'s ceiling on every dimension, and admin policy permits that egress class:

```
admit(C, S)  ⟺  S.reach.egress ≤ C.classification.egress
             ∧  S.reach.audience ≤ C.classification.audience
             ∧  policy.permits(S.reach)
```

The intended semantics are containment: the label *caps* where content may go, so a `{ internal, admin }` audit record never becomes a candidate for a `{ external, public }` sink. (That is the inverse of secrecy-clearance "read up," which is why the sink attribute is `reach`, not `clearance` — flip the comparison and the gate inverts.) The depth behind `policy.permits` — what an operator can express, how it is enforced and audited, how it composes with the curation governor's existing egress reasoning — is a later authorization pass. The containment check (`reach ≤ ceiling`) is live; `policy.permits` is an allow-all stub until that pass lands, so the gate enforces the ceiling today and gains operator policy later without changing shape.

**Routing — structural, and only structural.** Among admitted sinks the router matches each sink's `accepts` (the descriptor features it can render) against the features the descriptor actually carries — the one structural predicate every sink family routes through (notifications included, since its private channel matrix retired in favour of this). By the time routing runs only admissible sinks remain, so routing never reasons about egress at all.

Classification is a **governed vocabulary**, not free-form strings: both authors `import` the same enums from `@delphian/tronrelic-types`, and registration refuses an unknown dimension (fail-fast, like the [hooks registry](./system-hooks.md) refusing unknown descriptors). Keep the set coarse and orthogonal to type; a dimension that re-encodes the `typeId` rebuilds the coupling the router removes. The two starter dimensions are orthogonal on purpose — `{ external, admin }` ("may leave the building, but only to admins at the far end") is a coherent, if unusual, label, and the componentwise rule handles it without special cases.

### Potential versus mandated

Two policy layers, coarse then fine. The router computes the **potential** sinks for a type — those the classification gate admits (reach within ceiling, policy permits) whose structural `accepts` matches the descriptor. The gate is the coarse, safety-oriented layer: *can this class of sink ever receive this class of content?* The **mandated** subset is the fine, operational layer — admin-owned policy data naming which potential sinks actually fire and supplying each one's destination config (a Twitter handle, a Telegram chat id). Redirect and multi-direct are edits to that data, never to code — **separation of mechanism from policy**: capability and reach are code the sink owns, the gate is core mechanism, the binding is data the admin owns, the same split notifications draws between Channel and Policy.

### Selecting the mandated subset at the gate

The mandated subset need not be standing policy fixed ahead of time — the human review gate is the natural place to choose it per item. A curation type that opts in (`publishesToDestinations`) turns its approval into a destination decision: at review the queue computes the gate-admitted `publish` sinks for the item, and the curator selects which fire — the same person answering "is this fit to release?" also answering "where does it go?". Eligibility is computed structurally (`accepts ⊆ present`) and through the classification gate (`reach ≤ ceiling`, the type's `classification` or a restrictive `{ internal, admin }` default), so a sink registered later surfaces with zero curation edits. Standing per-type defaults pre-select a subset; the curator confirms or overrides — policy data and human judgment compose, neither replaces the other. The selection is required where it is possible: an item with any eligible publish sink blocks an empty-selection approval (enforced at the curation service, mirrored by the picker's disabled Approve button), so a decision never records while publishing nowhere; an item with zero eligible sinks approves to nowhere unguarded, the only available outcome.

This forces one addition to the sink contract: `IContentSink.kind` (`gate` / `delivery` / `publish`). A selector must filter by *role*, which `reach` alone cannot encode — the curation gate and an audit log both sit at `{ internal, admin }` yet only one is a publishable destination. The picker offers `publish` sinks only: offering the gate sink would re-enqueue the item under approval (an infinite hold loop), and offering a match-only `delivery` sink whose `deliver()` throws would fail at send.

On approval the selection is persisted with the decision (the publish intent commits atomically, never lost to a crash before delivery) and committed to the durable [syndication](#decisions-and-open-questions) outbox; its relay delivers each leg with idempotent retry and dead-lettering, and the live per-leg outcome (`delivered` / `failed` / `refused`) overlays the item's audit on read. Curation acts here as an **originator**, re-originating the approved descriptor into syndication; the fan-out lives in syndication plus each sink, never in `onApprove`, which stays for the type's own bookkeeping. (Absent the syndication module — a degraded boot — curation falls back to an in-process best-effort fan-out.) The credential-free core `core:internal-publish` sink (writes a record, emits an admin signal) is the first selectable destination, so the arc works end-to-end before any external outlet exists.

### typeId is identity, never control flow

A sink may see a content type's id, but the id must never be **load-bearing**. The enforceable test is **graceful degradation**: a sink must produce valid output for a compatible content type authored *after* the sink. If introducing a new compatible type requires editing a sink, the decoupling is fake. When a sink legitimately needs something the descriptor lacks, the fix is to **enrich the IR** (the type adds a generic `fields` entry every sink benefits from) or, rarely, a registered **edge translator** that quarantines type-specific knowledge with an explicit owner — never an `if (typeId === …)` inside the sink.

`fields` is the escape hatch most likely to leak, so govern it concretely rather than leaving it open. An untyped string-keyed bag is the **stringly-typed** trap: the moment one sink reads `fields['threadId']` and another reads `fields['recipientGroup']`, those keys are invisible magic-string dependencies — the same `typeId` coupling, hidden behind the abstraction. The discipline: every legal `fields` key is declared once in a shared, typed key map in `@delphian/tronrelic-types`; `describe()` may write only declared keys; a sink may read them only through that typed accessor — so a sink reading a key no type writes fails the build, not silently at runtime. When two unrelated types and a sink converge on the same key, that convergence is the signal to promote it into a first-class descriptor slot or a typed sub-shape. The registry turns the escape hatch from an open grab-bag into a small, reviewed surface; without it, `fields` quietly becomes the point-to-point coupling the router exists to remove.

### Mutators have two altitudes

The **canonical mutator** is the editor: `applyEdit(ref, patch)` on the content type, the validation authority over the neutral `body`, shared by every pipeline. A **destination adapter** is the per-sink transform inside `deliver()` (truncate to 280 for Twitter, build a title for Reddit). The compliance line: an adapter must not masquerade as the canonical editor, or one type's `body` silently becomes one destination's shape.

Two gaps the design keeps in view. First, **mapping is more than config** — and still open: destination config today is a flat bag (a handle, a chat id); a non-trivial sink needs a declared, validated mapping from descriptor to wire shape — a per-destination action map versioned with the sink (the shape a CDP's destination-actions framework formalizes), not field reads scattered through `deliver()`. Second, **structural match is necessary, not sufficient.** Matching `accepts` against the features present catches a sink that *cannot render* a feature; it does not catch **semantic loss** — a `title` flattened past the meaning its type intended (a checksummed address label rendered as bare text). Where fidelity matters, a sink refuses a descriptor it cannot render faithfully — a typed refusal the delivery audit records — rather than emit a lossy approximation that looks like success. Both families realize this: notifications as `IChannelDeliveryResult.refused` on its channel result, and the publish path as an `IContentSinkRefusal` resolved from `IContentSink.deliver` (distinct from a thrown failure — a refusal is a settled "will not", a failure a retryable "could not"), which curation records as a `refused` destination outcome with the sink's reason verbatim. The refusal *channel* ships; the richer descriptor signal a sink needs to *decide* a within-slot loss (telling "a title" from "a title that means an address") is the open **mapping is more than config** item above, not this mechanism.

### Delivery semantics are family-specific

The router owns registration and candidate matching; what reception *costs* is the sink family's concern. A gate sink (curation) holds for a human decision behind an atomic gate. A delivery sink (notifications) applies per-channel throttle and per-user opt-out. A publish sink fans out to N outlets where each delivery fails independently. The shipped publish path — curation's destination picker enqueuing the selected publish legs into the `syndication` family — is durable: the outbox commits the intent with the decision, and the relay delivers each leg with idempotent retry and dead-lettering. For *external* outlets that independence is where the hard part lives, and the `syndication` family owns the durable answer below.

In-process best-effort fan-out — a bare `Promise.allSettled` over the sinks — is a **dual-write hazard**: a crash mid-fan-out loses effects with no record to retry from, the same gap curation's record-decision-then-callback would carry (the decision is durable, the effect is not). For an *external publishing* feature that is not a placeholder, it is a defect. The durable shape the `syndication` family implements is a small, well-worn stack:

- **Transactional outbox.** In the same transaction that records the decision (curation's atomic gate, or a syndication request), write one outbox row per `(descriptor, destination)`. Decision and intent commit together or not at all — closing the exact gap the current gate-then-callback leaves open.
- **Async relay.** A worker drains outbox rows, invokes each sink's `deliver`, and marks the row delivered or failed. The fan-out is now durable and observable, not a fire-and-forget in the request path.
- **Idempotent receiver.** Each row carries a stable idempotency key derived from `(originId, sinkId)`, handed to the sink as the optional `IContentDeliveryContext` third argument of `deliver`; the sink passes it to the external API, or dedupes on it, so a retried row cannot double-post. (EIP Idempotent Receiver; the same shape Stripe exposes as an idempotency key.)
- **Retry with backoff, then dead-letter.** A failed row retries with exponential backoff; after a bounded number of attempts it dead-letters to a per-destination channel for operator attention. A failed Reddit post neither blocks nor duplicates the delivered Twitter post.

One human approval releasing N external effects is a **saga**, not an atomic commit: there is no two-phase commit across Twitter, Telegram, and Reddit, so each destination is its own at-least-once leg. "All-or-nothing" is available only as *compensation* — retract or delete the legs that landed when another leg fails permanently — and whether the product even wants that, versus letting partial success stand, is a syndication policy decision the router does not make. The honest delivery contract is **at-least-once plus idempotency, which is effectively-once**; exactly-once across external HTTP APIs is not on offer, and the design must not pretend otherwise. The full syndication contract is [system-syndication.md](./system-syndication.md) (implementation in the [module README](../../src/backend/modules/syndication/README.md)); curation enqueues into it, so its publish legs are durable. (When the syndication module is absent — a degraded boot — curation falls back to an in-process best-effort fan-out, the one path where the dual-write posture still applies.)

## The Contract

| Member | Role |
|---|---|
| `IContentClassification` | Core-declared sensitivity label `{ egress, audience, … }` the content type carries; a *ceiling* on exposure, data about content, never a routing rule |
| `IContentSink.accepts` | Descriptor features the sink can render; matched at dispatch against features present — the **only** routing predicate |
| `IContentSink.kind` | The sink's family role (`gate` / `delivery` / `publish`); a selecting pipeline filters destinations by it (the curation picker offers `publish` only). Data the sink declares, not a routing predicate |
| `IContentSink.reach` | The exposure the sink causes (its `{ egress, audience }` position); evaluated by the gate, never read at dispatch |
| `IContentSink.deliver(content, dest, context?)` | IR → wire; reads only the descriptor, the admin-supplied destination config, and an optional `IContentDeliveryContext` (idempotency key + attempt) a durable family supplies. Resolves `void` when delivered or an `IContentSinkRefusal` when the sink declines (a settled "will not", recorded distinctly from a thrown failure); throws on failure. Per-destination idempotency/retry is the sink family's concern, not the router's |
| classification gate | Seam run **before** routing: admits a sink only when `reach ≤ classification` on every dimension. Ships with the shape and direction; the policy and enforcement model is a later pass |
| `IContentRouter` | Sink registry + structural `candidates(features)` over admitted sinks (a **Recipient List**); published `'content-router'`, peer of `'content-types'` |

## Modular Placement

Placement follows the [module-vs-plugin test](./modules/modules.md#module-vs-plugin-decision-matrix) — *can the app function without it?* — applied per layer.

| Layer | What it is | Lives as | Why |
|---|---|---|---|
| Router primitive | Sink registry, the classification gate, structural candidate matching, dispatch seam, classification enums | **Core** — bootstrap registry adjacent to `content-registry.ts`, published `'content-router'`; enums in `@delphian/tronrelic-types` | A primitive every pipeline sits on; constructed before module init, a peer of the hooks/services/content-types registries |
| Sink families | A family's policy data, admin surface, and delivery semantics | **Modules** — `curation` (gate), `notifications` (delivery), `syndication` (publish) | Persisted policy + audit + admin surface + non-toggleable infra is module-shaped, the same reasoning that made notifications a module |
| Concrete sinks | One outlet: `accepts`, `reach`, adapter, `deliver` | **Plugins** — `trp-x-poster`, `trp-telegram-bot`, a future `trp-reddit` | Optional, runtime-toggleable, externally integrated; register their `IContentSink` against `'content-router'` via `context.services.watch` |

The split is single-responsibility: the **generic** half (registration, the classification gate, `candidates = accepts` over admitted sinks) is identical for a gate, a toast, and a tweet, so it is core; the **family-specific** half (what reception costs — the human hold, the throttle, the outbox) diverges, so each module owns it behind the shared seam. The model holds in practice: curation and notifications register as sink families on the router — each kept intact, not rewritten — rather than each carrying its own bespoke consumer wiring.

One sink lives outside this table by design: the credential-free `core:internal-publish` sink (`kind: 'publish'`, `reach { internal, admin }`) is registered in bootstrap as **core** demo infrastructure — it writes a record and emits an admin signal rather than integrating an outlet, so the curation destination picker has a real, selectable destination before any plugin sink exists. A production external sink is the plugin shape the table prescribes, and `trp-telegram-bot` already realizes it: one `kind: 'publish'`, `reach { external, public }` sink per admin-allowlisted channel, bound on the router via `context.services.watch` and torn down on `disable()` (`trp-x-poster` and a future `trp-reddit` follow the same shape).

## Compliance Invariants

1. Only `describe()` reads the payload; sinks read only the `IContentDescriptor`.
2. A sink's *only* routing predicate is `accepts` over descriptor features — never `typeId`, never classification.
3. Classification admissibility (may this egress, to whom) is decided by the policy gate before routing; a sink declares `reach` as data and never branches on classification.
4. The gate admits a sink only when its `reach` stays within the content's classification ceiling on every dimension. The label *caps* exposure (DLP-containment); it never grants it. The relation is `reach ≤ classification`, not the reverse.
5. Every sink passes the unknown-type test: valid output for a compatible type authored after it.
6. Contract gaps are closed by enriching the descriptor or a registered edge translator — never id-special-casing; every `fields` key is declared in a shared typed registry, so reading an unwritten key is a compile error.
7. A sink registers capability against the router; the type→destination binding is admin policy data.

## Example

A `tronrelic:mediaPost` (classification `{ egress: 'external', audience: 'public' }`) fans to Twitter and Telegram. The media module owns the type and names no sink; each plugin owns its sink and names no type. This sketch shows the model end-to-end, including the durable `syndication` delivery in step 4 (now shipped). In production the curation destination picker is the originator, enqueuing the selected `core:internal-publish` and `trp-telegram-bot` legs into syndication (see [Selecting the mandated subset at the gate](#selecting-the-mandated-subset-at-the-gate)).

```typescript
// @delphian/tronrelic-types — the shared dictionary both authors import
export interface IContentClassification {
    egress: 'internal' | 'user' | 'external';   // how far the content MAY be exposed (a ceiling)
    audience: 'admin' | 'user' | 'public';      // how broadly
}

/**
 * A capability-registered consumer of content. Declares the descriptor features it can
 * render and the exposure it causes, so the platform can authorize and match it without
 * either side naming the other's identity. The sink runs no routing predicate of its own.
 */
export interface IContentSink {
    id: string;
    accepts: Array<'title' | 'body' | 'media' | 'details'>;   // structural capability — the routing predicate (the typed `fields` map is enrichment, not a feature)
    reach: IContentClassification;                            // the sink's exposure; the gate checks reach <= classification
    deliver(content: IContentDescriptor, dest: Record<string, unknown>): Promise<void>;
}
```

```typescript
// Twitter plugin. The adapter is the IR back-end; Twitter's 280 limit lives only here.
const twitterSink: IContentSink = {
    id: 'twitter',
    accepts: ['body'],
    reach: { egress: 'external', audience: 'public' },   // publishing to Twitter exposes content externally, publicly
    async deliver(d, dest) {
        const head = (d.title ? `${d.title}: ` : '') + (d.body ?? '');
        await twitterApi.post(dest.handle as string, head.slice(0, 280).trimEnd(), d.media?.[0]?.url);
    },
};
```

```typescript
// 1. Authorize: the gate admits only sinks whose reach stays within the content's ceiling
//    (DLP-containment) and that admin policy permits. mediaPost's { external, public }
//    admits Twitter ({ external, public }); an { internal, admin } audit log would not.
const admitted = policyGate.admit(mediaPostType.classification, router.sinks);

// 2. Route (Recipient List): structural match among admitted sinks.
const d = await mediaPostType.describe(ref);
const present = new Set(Object.entries(d).filter(([, v]) => v != null).map(([k]) => k));
const potential = admitted.filter(s => s.accepts.every(f => present.has(f)));   // -> [twitterSink, telegramSink]

// 3. Bind: admin policy is the mandated subset of `potential` plus each destination's config.
const bindings = [
    { sink: twitterSink, dest: { handle: '@tronrelic' } },
    { sink: telegramSink, dest: { chatId: -1001234 } },
];

// 4. Deliver: enqueue one durable outbox row per binding (committed with the decision),
//    then the syndication relay delivers each leg under an idempotency key and dead-letters
//    on exhaustion, so a Twitter 500 neither fails nor duplicates the Telegram send.
await syndication.enqueue({
    originId: ref.id, originKind: 'mediaPost', descriptor: d,
    legs: bindings.map(b => ({ sinkId: b.sink.id, dest: b.dest }))
});
```

A later `tronrelic:announcement` with the same classification and a `body` becomes a candidate for both sinks the instant it registers — zero sink edits. That automatic eligibility is the proof the abstraction is real rather than academic.

## Decisions and Open Questions

**Settled — the originator role stays informal.** It is not a registered handler. Origination owns the `ref` and its triggers are too varied (a tool handler, a cron job, a webhook) to key by content type; formalizing it was considered and rejected. Originators are simply whoever holds or fires content; only mutators and sinks register against the type/router.

**Settled — curation and notifications are sink families.** Both register on the router and route matching through it. Curation registers the `curation:gate` sink and, for a `publishesToDestinations` type, drives the destination picker. Notifications registers one sink per channel and matches candidates with the router's `accepts ⊆ present` floor; the inverse `present ⊆ accepts` channel ceiling it once carried is retired, its fidelity role moved to a deliver-time **refusal** (`IChannelDeliveryResult.refused`) recorded in the audit — a channel declares the empty floor, matches any content, then refuses at delivery what it cannot render faithfully. (The two predicates are genuine inverses, not the same rule renamed.) Each family keeps its own delivery: `IContentSink.deliver` resolves `Promise<void | IContentSinkRefusal>` — notifications routes *matching* through the router and never delivers a sink through it (its refusal rides `IChannelDeliveryResult.refused` on the channel result); curation's publish fan-out enqueues into the durable `syndication` outbox (falling back to in-process best-effort only when that module is absent), and overlays each leg's live state — a resolved refusal as `refused`, a thrown error as `failed` — onto the item's destination outcomes on read. (The earlier `Promise<void>` shape predated the publish refusal need; `void` remains a valid resolution, so existing void-returning sinks are unchanged.)

**Shipped — syndication delivery.** The durable stack is now built and is the [syndication module](../../src/backend/modules/syndication/README.md): transactional outbox (`module_syndication_outbox`), a `syndication:relay` scheduler job that claims due legs by compare-and-swap, an idempotency key derived `(originId, sinkId)` and handed to each sink via the optional `IContentDeliveryContext` third argument of `deliver`, capped-exponential retry with a default eight-attempt budget, and a dead-letter state with a `/api/admin/system/syndication` operator surface (stats, dead-letter list, retry). The settled policy: one approval releases its N legs as **independent at-least-once deliveries** (no saga, no compensation — partial success stands), so the honest contract is at-least-once plus idempotency. Curation enqueues into it within the decision and reads live leg state back on overlay; `onApprove` sees `pending` intent because delivery is now asynchronous. [system-syndication.md](./system-syndication.md) is the prescriptive contract; the [module README](../../src/backend/modules/syndication/README.md) is the implementation reference.

**Open — authorization and security model.** The classification gate runs with the right shape and direction, but `policy.permits` is an allow-all stub. The policy an operator can express (cut external egress, pin a category's audience, per-sink overrides), how it is enforced and audited, and how it composes with the curation governor's existing egress reasoning are a later security pass — filled in *between the seams* this layer establishes, not baked into the router. This is the one area that remains deliberately unresolved.

**Names — settled.** The locked working set: the service name `'content-router'` (a **Recipient List** / **Dynamic Router**), the `IContentClassification` / `IContentSink` / `IContentRouter` interfaces, the `reach` and `kind` (`gate` / `delivery` / `publish`) sink attributes, the curation `publishesToDestinations` opt-in, and the starter dimensions `egress` (`internal | user | external`) and `audience` (`admin | user | public`). The `syndication` module name is now settled — the module ships under it.

## Further Reading

- [system-content-types.md](./system-content-types.md) — the noun the router routes; `describe()` and the `IContentDescriptor` IR
- [system-curation.md](./system-curation.md) — the gate-sink family: hold for human review, commit on decision; the atomic gate the outbox builds on
- [system-notifications.md](./system-notifications.md) — the delivery-sink family; the `accepts` capability matrix this generalizes into structural routing
- [system-syndication.md](./system-syndication.md) — the durable publish-sink family; the at-least-once-plus-idempotency delivery contract curation enqueues into
- [system-hooks.md](./system-hooks.md) — the declared-registry pattern classification matching mirrors (refuse unknown entries)
- [system-ai-tools.md](./system-ai-tools.md) — the typed capability classes the classification dimensions are modeled on
- [plugins-service-registry.md](../plugins/plugins-service-registry.md) — how a sink plugin resolves `'content-router'` via `context.services.watch`

**Industry patterns this design rests on:**

- [Recipient List](https://www.enterpriseintegrationpatterns.com/patterns/messaging/RecipientList.html) and [Dynamic Router](https://www.enterpriseintegrationpatterns.com/patterns/messaging/DynamicRouter.html) — the fan-to-many dispatcher the "router" actually is (not a single-destination Content-Based Router)
- [Message Translator](https://www.enterpriseintegrationpatterns.com/patterns/messaging/MessageTranslator.html) — the per-sink adapter (IR → wire)
- [On the Hourglass Model](https://cacm.acm.org/research/on-the-hourglass-model/) — why a deliberately minimal canonical IR (narrow waist) turns N×M into N+M, and why growing it is the anti-pattern
- [NIST SP 800-162 (ABAC)](https://csrc.nist.gov/pubs/sp/800/162/upd2/final) and [Purview DLP — sensitivity label as condition](https://learn.microsoft.com/en-us/purview/dlp-sensitivity-label-as-condition) — classification-as-ceiling evaluated by a policy decision point, the model for the authorization gate and its `reach ≤ classification` direction
- [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html), [idempotent consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html), and [saga](https://microservices.io/patterns/data/saga.html) — durable multi-sink delivery and one-approval-to-N
- [Primitive obsession / stringly-typed](https://refactoring.guru/smells/primitive-obsession) — the `fields` grab-bag risk the typed key registry closes
