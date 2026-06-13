# AI Tool Standard

AI tools let a model call back into TronRelic during a query — look up a transaction, read logs, post to a channel, generate an image. This document is the contract every tool implements and the accountability and security every tool must meet, whichever AI provider plugin is installed.

> **Status.** The capability metadata and the central tool governor described here are being introduced incrementally; today the registry and dispatch live in the active AI provider plugin (`trp-ai-assistant`). The *requirements* in [Accountability and security](#accountability-and-security) are mandatory now — classify your tool and apply the matching guardrails by hand, as the reference tools already do.

## Why This Matters

A tool turns the model's text into action. A read-only lookup is low-stakes; a tool that posts publicly, sends a message, spends money, or reads a private file is not. Two failure modes make this acute: a model mistake invokes the wrong tool with the wrong arguments, and prompt injection — attacker-controlled text the model ingests — turns the model against you. TRON memos, fetched web pages, and social timelines are all attacker-controlled and flow straight into the context.

The danger compounds when the *enabled* tool set spans the **lethal trifecta**: access to private data, exposure to untrusted content, and a channel to send data out. Any one alone is safe; all three together let injected text read a secret and exfiltrate it in a single turn. Core owns this standard so every tool — and every future provider plugin — inherits the same guarantees instead of re-inventing them unevenly.

## Provider-Agnostic Model

Core defines the tool contract, the capability vocabulary, and the registry, governor, policy, and audit. An AI **provider plugin** is only a transport: it formats tool declarations for its vendor's API, runs the agentic loop, and routes each tool call back through core. `trp-ai-assistant` is the Anthropic provider; an OpenAI or Google provider would be a separate plugin. Tools are provider-neutral and must never import or assume a specific provider.

## The Tool Contract

A tool is an [`IAiTool`](../../packages/types/src/ai-tools/IAiTool.ts) with four fields.

| Field | Purpose |
|---|---|
| `name` | Unique; matches `^[a-zA-Z0-9_-]{1,64}$`. Prefix platform-default tools `tronrelic-`. |
| `description` | The dominant factor in selection accuracy. State what it does, when to use and not use it, every parameter, the return shape, and limits. Vague descriptions misfire. |
| `inputSchema` | JSON Schema, top-level `type: 'object'`. Every property needs a `type` and `description`; set `additionalProperties: false`; list genuinely required params. |
| `handler` | `(input) => Promise<unknown>`. Runs server-side; the return value is JSON-serialized back to the model. |

Register through the service registry with `watch()` (never `get()` — it covers the boot-order race and provider toggling), and unregister on `disable()`. Pass your `manifest.id` as the provider id so the admin UI groups your tools.

## Classify Your Tool

Classify every tool before it ships; the class drives the guardrails core expects. Until the formal `capability` field lands on the contract, encode the classification in the description and apply the guards by hand.

| Dimension | Values | Drives |
|---|---|---|
| Side effect | `read` · `write` · `external` | Whether mutation/escape guards apply |
| Reversible | yes / no | Approval + autonomous-path rules |
| Spends money | yes / no | Cost cap + quota |
| Sensitivity | `public` · `internal` · `secret` | Audit redaction + trifecta accounting |
| Surfaces untrusted content | yes / no | Trifecta accounting (injection source) |
| Requires approval | yes / no | Human-in-the-loop gate |

A transaction lookup is read / internal. A log query is read / secret / surfaces-untrusted. A tweet is external / irreversible / requires-approval. An image generation is external / spends-money.

## Accountability and Security

Mandatory for every tool; scale to the class. A read-only lookup needs little, an external action needs all of it.

**Least privilege, default-deny for danger.** External, irreversible, and money-spending tools are opt-in and ship disabled. They must not run on autonomous paths (scheduled prompts, programmatic `ask()` from other plugins) unless explicitly authorized — an unattended run has no human to catch a mistake.

**Validate every input.** The schema is a hint to the model, not a guarantee. Re-check every argument in the handler (format, range, enum) and reject with a descriptive error the model can correct from. Never pass model-supplied values into a query, path, command, or URL unchecked.

**Authorize object access.** A tool addressed by id (file id, record id) must verify the caller may access that object. Knowing the id is not authorization — ids leak and enumerate.

**Bound side-effecting and paid tools.** Rate-limit, quota, and cap cost. A looping or injected model must not drain an API budget or flood a channel. `TransactionToolGuard` is the reference limiter.

**Require human approval for irreversible or public effects.** Park the action for admin approval instead of executing inline. `trp-x-poster` is the reference: every AI-authored post waits for a human.

**Audit every invocation.** Record who triggered it (interactive admin / scheduled / programmatic), the arguments, the outcome, and the cost — enough to reconstruct what happened. `trp-image-gen`'s per-call history is the reference shape.

**Control egress.** A URL-fetching tool must block private-IP/SSRF targets and non-HTTP(S) schemes and cap response size. Reuse the shared egress helper rather than re-implementing it.

**Cap result size.** Truncate large payloads and point the model at a follow-up tool for the full record, so one call cannot blow the context window. The log tools are the reference.

## How It Works

The provider advertises the enabled tools to the model; when the model emits a tool call, the handler runs server-side and its result is fed back so the model can continue. Core is centralizing the cross-cutting concerns — input validation, policy by capability class, a per-handler timeout, audit, and human approval — behind a single governor and declared hook seams, so authors stop re-implementing them and operators get one place to see and tune every tool. See [system-hooks.md](./system-hooks.md) for the seam mechanism.

## Example

A minimal, correct read-only tool — validate input, return a descriptive error, classify in the description.

```typescript
// Capability: read / internal — strictly read-only, safe to call repeatedly.
const tool: IAiTool = {
    name: 'tronrelic-get-thing',
    description:
        'Fetch one thing by its 24-character hex id. Use when the user references ' +
        'a specific thing. Returns the thing, or null when the id is unknown ' +
        '(not an error). Read-only; never mutates.',
    inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '24-character hex id.' } },
        required: ['id'],
        additionalProperties: false
    },
    handler: async (input) => {
        const id = String(input.id ?? '');
        if (!/^[a-f0-9]{24}$/i.test(id)) {
            return { success: false, error: 'id must be a 24-character hex string' };
        }
        return { success: true, thing: await thingService.getById(id) };
    }
};
```

## Reference Implementations

| Tool | Class | What to copy |
|---|---|---|
| `tronrelic-get-transaction` (blockchain) | read / internal | Input regex; global rate limiter (`TransactionToolGuard`) + usage stats |
| logs `tronrelic-query-system-logs` | read / secret | Result + context caps; truncate-and-point-to-detail |
| `trp-x-poster` post | external / irreversible | Mandatory admin approval queue; caller attribution |
| `trp-image-gen` | external / spends money | Per-call forensic history; sanitized vs raw error split |

## Pre-Ship Checklist

- [ ] Classified: side effect, reversibility, spend, sensitivity, untrusted-content, approval
- [ ] `description` states purpose, when (not) to use, params, return shape, limits
- [ ] Every input re-validated in the handler; descriptive errors returned
- [ ] Object access authorized for id-addressed tools
- [ ] Side-effecting/paid tools rate-limited, quota'd, cost-capped
- [ ] Irreversible/public effects gated behind human approval
- [ ] URL-fetching tools use the shared egress/SSRF guard
- [ ] Result size capped
- [ ] Registered via `watch()`; unregistered on `disable()`; tagged with `manifest.id`
- [ ] External/irreversible tools ship disabled and barred from unattended runs

## Further Reading

- [trp-ai-assistant/README.md](../../src/plugins/trp-ai-assistant/README.md) — the reference AI provider plugin: registration, dispatch, programmatic queries
- [plugins-service-registry.md](../plugins/plugins-service-registry.md) — `watch()` vs `get()`, registration lifecycle
- [system-hooks.md](./system-hooks.md) — declared seams that tool governance attaches to
- [system-database.md](./system-database.md#plugins) — scoped storage for a tool's audit or history
- [environment.md](../environment.md) — scheduler and key configuration affecting autonomous tool runs
