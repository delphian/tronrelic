# Documentation Guidelines

This guide keeps TronRelic's documentation consistent, concise, and immediately useful. Share it with anyone writing a new document or refreshing an existing one.

## Before You Write

Load the project rules first. Read `README.md`, the project instruction files such as `CLAUDE.md`, and any reference material specific to your topic before you start drafting. Identify your audience — plugin authors, maintainers, or operators — and write for that group. Each document should solve a single reader problem. When a neighbouring topic comes up, link to the document that owns it rather than restating it.

Never put sensitive data in documentation. That means API keys, credentials, database connection strings, and details of unpatched security vulnerabilities. Documentation gets copied into AI context windows, and version control keeps a copy of the file even after you delete it. Assume anyone can read what you write.

Model a new document on the closest existing one rather than on this guide alone. For a directory summary that acts as a gateway to detail documents, follow [system.md](./system/system.md) or [frontend.md](./frontend/frontend.md). For a plugin or module README that leads with its contract, follow [trp-ai-assistant/README.md](../src/plugins/trp-ai-assistant/README.md).

## Style Priorities

Follow these three in order.

1. **Lead with why.** Explain what the system is for and what goes wrong if someone ignores the guidance. A reader should understand the purpose before seeing the implementation steps.
2. **Follow with how.** Describe the workflow in plain English paragraphs. A short narrative summary usually serves the reader better than a bulleted list.
3. **Close with code.** If a code sample is needed at all, include one short representative snippet that reinforces what the prose already said. Avoid sprawling examples that force the reader to infer the point.

## Tone and Language

Write in plain English, as if explaining the topic to a teammate rather than compiling a reference manual. Prefer the active voice: "Use `database.set` to seed defaults" reads better than "Defaults should be seeded with `database.set`." Define each unavoidable domain term once and then rely on that definition. Use the exact names that appear in `@/types` and the shared packages so the vocabulary in the docs matches the vocabulary in the code.

Keep sentences short and scannable, and prefer paragraphs to bullet points. Reach for bullets only when the structure genuinely helps, such as a list of discrete items that paragraph form would obscure. Tables work well for quick reference sections, command summaries, and comparison matrices, where being able to scan matters more than narrative flow.

Write documentation as instructions. State what to do, not what someone might consider doing.

### How Much to Cut

Cut filler such as "it should be noted that," "in order to," and "it is important to." Cut hedging such as "basically," "essentially," and "generally speaking." Cut phrasing that repeats a point already made.

Stop there. Keep the sentence that explains why a pattern exists, keep the plain-English restatement of a dense concept, and keep the linking sentences that orient a reader who is new to the subsystem. Those sentences are doing real work for the reader, so removing them makes the document harder to use.

The audience standard is a capable mid-level developer meeting the topic for the first time. Writing for that reader means spelling out an acronym on first use, choosing a plain phrase over a compressed technical one when both are accurate, and not letting terseness turn a paragraph into shorthand only the original author can follow. Use complete sentences rather than fragments. Prefer a slightly longer sentence that reads clearly the first time over a short one the reader has to read twice.

Write at the level an average mid-level developer would write, not above it. Do not use polished turns of phrase, aphorisms, or rhetorical flourishes, even when they read well. Write plain instructional prose.

### Avoid Inventing New Terms

When you compress a document, it is tempting to invent a noun phrase for anything you explain more than once. This creates a problem for readers who arrive partway through the document, or who search for one section and read only that. They meet the invented term without ever seeing the sentence that defined it, and they have no way to work out what it means.

Prefer vocabulary that already exists in the codebase, in `@tronrelic/types`, or in general industry use. Invent a term only when nothing existing fits, define it in a single sentence the first time it appears in each document, and never replace a plain phrase with a new term just to save words.

## File Size Limits

Documentation serves both people and AI tools. AI coding assistants load project instruction files and referenced documentation into a limited context window, so a bloated file spends that budget on content irrelevant to the task at hand and makes the assistant less effective. Keeping documents focused helps human readers scan them and helps AI tools use them.

| Document type | Limit | Reasoning |
|---------------|-------|-----------|
| Project instruction files | Under 100 lines | Loaded into every session, so every line must be universally relevant |
| Summary documents | Under 150 lines | Entry points whose job is to orient the reader and link to details |
| Detail documents | Under 300 lines | Focused documents covering a single concern |

If a topic needs more than 300 lines, split it into several focused documents. Keep summary documents short: give context and link onward instead of duplicating what the detail document already says.

### Exception: Module and Plugin READMEs

A `README.md` that sits inside a module directory (`src/backend/modules/*/README.md`) or a plugin directory (`src/plugins/*/README.md`) is the *complete* documentation for that feature. Architecture, API reference, database schema, usage examples, and troubleshooting all belong in that one file. These files are deliberately exempt from the 300-line limit, because they are the single source of truth for their feature and splitting them would scatter context that developers need together.

These READMEs are written as reference material for an AI coding agent rather than as narrative onboarding, since the main consumer is an agent that needs to use or modify the feature. That applies to the structure only. The writing itself still has to work for a person, so an engineer who has never seen the feature has to be able to read the file without help.

In practice, lead with the surfaces a reader needs to locate quickly: the plugin id, the name it registers under in the service registry, the admin URL, the types package, the manifest path, and a map of the source files. Then publish the contract as scannable tables — service method signatures, REST endpoints, WebSocket events, storage schema, scheduler jobs, and lifecycle obligations. Keep prose only where the contract alone cannot carry the reasoning, such as why a tool's description drives selection accuracy, or why `services.watch()` is the right call instead of `services.get()`.

Leave out narrative onboarding, marketing language, implementation trivia ("markdown rendered via remark processSync"), and rationale you have already given elsewhere. An agent that needs to know exactly how the feature behaves reads the source. The exemption covers length only, and everything above about concision still applies. See `src/plugins/trp-ai-assistant/README.md` for the reference implementation.

## Structure Template

Every document should follow the why → how → example rhythm. Adapt the headings to your topic, but keep that flow.

```markdown
# Document Title

Brief intro stating the core problem solved.

## Why This Matters

Explain why the system exists and the consequences of deviating from it.

## How It Works

Plain English explanation of the workflow or system.

## Quick Reference

Commands, checklists, or tables for day-to-day usage.

## Further Reading

Links to related documents with context describing what each covers.
```

## Code Sample Guidance

Include code only when it makes something clearer. Keep samples short and focused on the single point being made. Inline comments should explain intent rather than restate what the line obviously does. Where possible, link to the real file instead of pasting a large excerpt that will drift out of date. Every sample must be syntactically correct and follow project conventions: four-space indentation, TypeScript, and JSDoc comments on functions and classes.

## Maintaining Existing Docs

Only revise a document when you can say what the revision improves. The most common mistake is adding large amounts of content without ever checking whether it helped. Prune sections that repeat information available elsewhere and link to the canonical location instead. When behaviour changes, update the quick-reference tables first, since those are what readers check. When you remove content, confirm that documents linking to it still make sense.

## Documentation Organization

TronRelic groups related documents into topic directories under `docs/`. This pattern came out of the `docs/frontend/` reorganization and applies to all new documentation.

### When to Create a New Directory

Create a subdirectory under `docs/` when the topic needs several related documents, covers a distinct domain or subsystem, will keep accumulating documentation over time, and has boundaries that do not overlap an existing directory. Current examples are `docs/frontend/` for architecture and styling, `docs/plugins/` for observers and WebSocket subscriptions, and `docs/system/` for backend infrastructure.

Do not create a directory for a single-file topic, for content that fits an existing directory, or for a temporary migration guide.

### Directory Structure Pattern

Each directory holds one summary document named after the directory, such as `frontend.md`, plus detail documents that carry the directory name as a prefix, such as `frontend-architecture.md`. The summary is the entry point: it gives the high-level picture and links to each detail document with a description of what that document covers.

This split lets a reader — or an AI tool — read the short summary first and pull in a detail document only when the current task actually needs it. Keep the two layers separate. A summary describes the topic and links onward, and the detail document holds the explanation. If the same content appears in both, the two copies will drift out of sync.

```
docs/topic-name/
├── topic-name.md              # Summary document (gateway/overview)
├── topic-name-subtopic-1.md   # Detailed document for first concern
└── topic-name-subtopic-2.md   # Detailed document for second concern
```

### Detail Document Scope

Each detail document covers a single concern, such as a discovery and implementation workflow, an architecture and design pattern, an operations and troubleshooting runbook, or a component and API reference. Link between files rather than repeating shared material, and give every concept exactly one canonical home.

### Cross-Referencing

Link generously, and always say what the reader will find at the other end. Describe the destination in the sentence that contains the link, as in "For hydration error prevention and the `<ClientTime>` API, see [ui-ssr-hydration.md](./frontend/ui/ui-ssr-hydration.md)." Avoid a link such as "See ui-ssr-hydration.md for more information," because the reader cannot tell whether following it is worth the interruption. Use relative paths and never hardcode repository URLs.

### Migrating a Topic to a Directory

When a single file grows too large for its limit, create the directory using a lowercase hyphenated name, write the summary document, break the original content into focused detail files, update every cross-reference in the codebase, and verify that all the links resolve.

## Final Review

Before publishing, confirm the document leads with why, uses terminology consistently with the code, gives actionable guidance rather than trivia, follows the directory pattern where it applies, describes its cross-references, and respects the line limit for its document type.
