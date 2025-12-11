# Documentation Guidelines

This guide keeps TronRelic's documentation consistent, concise, and immediately useful. Share it with anyone authoring new docs or refreshing existing ones.

## Before You Write

Load the project rules first. Read `README.md`, `AGENTS.md`, and any topic-specific references before drafting or updating content. Identify your audience—plugin authors, maintainers, or operators—and tailor language accordingly. Each document should solve a single reader problem; link out instead of duplicating large sections.

## Style Priorities

1. **Lead with "why."** Clearly explain the purpose and risk of ignoring the guidance. Readers should know why the system exists before seeing implementation steps.
2. **Follow with "how."** Describe the workflow in plain English paragraphs. Prefer brief executive summaries over bullet points or checklists.
3. **Close with code.** Provide a single brief representative code snippet (if necessary) that reinforces the narrative. Keep it focused—no sprawling examples that require readers to infer intent.

## Tone and Language

Write in plain English as if explaining to a teammate, not writing a reference manual. Prefer active voice ("Use `database.set` to seed defaults" instead of "Defaults should be seeded with `database.set`"). Define unavoidable domain terms once, then rely on that definition. Use exact terminology from `@tronrelic/types` and shared packages for consistency.

Keep sentences short and scannable. Prefer concise paragraphs over bullet points. Use bullet points only when the added clarity outweighs the preference for prose—such as listing discrete items where paragraph form would obscure structure. Tables work well for quick reference sections, command summaries, and comparison matrices where scanability matters more than narrative flow.

Documentation must be *authoritative* and *prescriptive*.

## File Size Limits

Keep documentation files under 500 lines. Files exceeding this limit risk being truncated when read by automated tools, defeating the purpose of comprehensive documentation. If a topic requires more than 500 lines, split it into multiple focused documents within a directory structure.

## Structure Template

Every document should follow the "why → how → example" rhythm. Adapt headings as needed, but maintain this flow:

```markdown
# Document Title

Brief intro stating the core problem solved.

## Who This Document Is For

Target audience description.

## Why This Matters

Explain risks of ignoring this guidance and benefits of following it.

## How It Works

Plain English explanation of the workflow or system.

## Quick Reference

Commands, checklists, or tables for day-to-day usage.

## Further Reading

Links to related documents with context describing what each covers.
```

## Code Sample Guidance

Only include code when it adds clarity. Keep samples minimal and focused. Inline comments should explain intent, not restate the obvious. When possible, link to real files instead of embedding large samples. Ensure all code samples are syntactically correct and follow project conventions: 4-space indentation, TypeScript, and JSDoc comments on functions and classes.

## Maintaining Existing Docs

Regularly prune sections that repeat information found elsewhere—link instead. Update quick-reference tables first when behavior changes. When removing content, ensure linked documents still make sense.

## Documentation Organization

TronRelic organizes documentation using a directory-based pattern that groups related topics under dedicated subdirectories. This pattern emerged from the `docs/frontend/` and `docs/markets/` reorganizations and applies to all future documentation.

### When to Create a New Directory

Create a subdirectory under `docs/` when a topic requires multiple related documents, represents a distinct domain or subsystem, will accumulate additional documentation over time, and has clear boundaries that don't overlap with existing directories.

Examples of directory-worthy topics include `docs/frontend/` for architecture and styling, `docs/markets/` for fetcher implementation and operations, and `docs/plugins/` for observer patterns and WebSocket subscriptions. Do not create directories for single-file topics, content that fits existing directories, or temporary migration guides.

### Directory Structure Pattern

Each documentation directory contains a summary document matching the directory name (e.g., `frontend.md`) plus detailed documents prefixed with the directory name (e.g., `frontend-architecture.md`). The summary document serves as the entry point, providing high-level overview and linking to detailed documents with descriptions of what each covers.

```
docs/topic-name/
├── topic-name.md              # Summary document (gateway/overview)
├── topic-name-subtopic-1.md   # Detailed document for first concern
└── topic-name-subtopic-2.md   # Detailed document for second concern
```

### Detailed Document Scope

Each detailed document addresses a single concern: discovery and implementation workflows, architecture and design patterns, operations and troubleshooting runbooks, or component and API references. Avoid duplication between files by linking to related sections. Each concept should have one canonical location.

### Cross-Referencing Patterns

Link liberally but provide context describing what the reader will find. Use relative paths—never hardcode repository URLs. Good links describe the destination: "For API discovery techniques, see [market-fetcher-discovery.md](./market-fetcher-discovery.md)." Bad links leave readers guessing: "See market-fetcher-discovery.md for more information."

### Migrating to Directories

When a topic outgrows a single file, create the directory with lowercase hyphenated name, write the summary document, break content into focused detail files, update all cross-references in the codebase, and verify links resolve correctly.

## Final Review

Before publishing, verify the document reinforces style priorities, uses consistent terminology, focuses on actionable guidance rather than trivia, follows directory organization patterns if applicable, includes proper cross-references, and stays under 500 lines.
