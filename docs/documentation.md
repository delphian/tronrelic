# Documentation Guidelines

This guide keeps TronRelic’s documentation consistent, concise, and immediately useful. Share it with anyone authoring new docs or refreshing existing ones.

## Before You Write

- **Load the project rules.** Always read `README.md`, `AGENTS.md`, and any topic-specific references (for example, plugin docs) before drafting or updating content.
- **Identify the audience.** Decide whether you are speaking to plugin authors, maintainers, or operators and tailor the language accordingly.
- **Confirm the scope.** Each document should solve a single reader problem—link out instead of duplicating large sections.

## Style Priorities

1. **Lead with “why.”** Clearly explain the purpose and risk of ignoring the guidance. Readers should know why the system exists before seeing implementation steps.
2. **Follow with “how.”** Describe the workflow in plain English using short lists or checklists. Reserve diagrams and tables for summary.
3. **Close with code.** Provide a single representative code snippet (if necessary) that reinforces the narrative. Keep it focused—no sprawling examples that require readers to infer intent.

## Tone and Language

- Write in plain English. Treat each paragraph like you're explaining the concept to a teammate, not writing a reference manual.
- Prefer active voice. ("Use `database.set` to seed defaults" instead of "Defaults should be seeded with `database.set`.")
- Define any unavoidable domain terms once, then rely on that definition. Use exact terminology from `@tronrelic/types` and other shared packages to maintain consistency across the codebase.
- Keep sentences short and scannable. Break up long explanations with bullet points or tables.
- Documentation must be *authoritative* and *prescriptive*.

## Structure Template

```
# Document Title
Short intro that states the core problem solved.

## Why This Matters
- Key risk/benefit point 1
- Key risk/benefit point 2

## How It Works
1. Ordered overview of the workflow
2. Highlight decision points

## Quick Checklist / Reference
- Bullet summary or table for day-to-day usage

## Example (Optional)
```typescript
// Minimal snippet demonstrating the narrative
```
```

Adapt the headings as needed, but always keep the “why → how → example” rhythm.

## Code Sample Guidance

- Only include code when it adds clarity. Verbose blocks belong in dedicated examples, not in the middle of explanation.
- Inline comments should explain intent, not restate the obvious.
- When possible, link to real files or appendices instead of embedding large samples.
- Ensure all code samples are syntactically correct and follow project conventions: 4-space indentation, TypeScript, and JSDoc comments on all functions and classes.

## Maintaining Existing Docs

- Regularly prune sections that repeat information found elsewhere—link instead.
- Update quick-reference tables or checklists first when behaviour changes.
- When removing content, ensure any linked documents still make sense.

## Documentation Organization

TronRelic organizes documentation using a directory-based pattern that groups related topics together under dedicated subdirectories. This pattern emerged from the `docs/frontend/` and `docs/markets/` reorganizations and should be followed for all future documentation efforts.

### When to Create a New Directory

Create a new subdirectory under `docs/` when a topic area meets these criteria:

- **Multiple related documents** - The topic requires 2 or more detailed documents to cover adequately (not just a single file)
- **Distinct domain** - The topic represents a coherent subsystem or concern area (e.g., frontend architecture, market data system, plugin patterns)
- **Long-term stability** - The topic will likely accumulate additional documentation over time as the system evolves
- **Clear boundaries** - Related documents can be grouped without overlapping with other directories

**Examples of directory-worthy topics:**
- `docs/frontend/` - Frontend architecture, component patterns, styling system
- `docs/markets/` - Market fetcher implementation, pricing architecture, operations runbooks
- `docs/plugins/` (hypothetical) - Plugin system, observer patterns, WebSocket subscriptions

**Do not create directories for:**
- Single-file topics that don't require detailed breakdowns
- Topics that fit naturally into existing directories
- Temporary documentation or migration guides (keep these in root `docs/`)

### Directory Structure Pattern

Each documentation directory follows this structure:

```
docs/topic-name/
├── topic-name.md              # Summary document (gateway/overview)
├── topic-name-subtopic-1.md   # Detailed document for first major concern
├── topic-name-subtopic-2.md   # Detailed document for second major concern
└── topic-name-subtopic-3.md   # Additional detailed documents as needed
```

**Naming conventions:**
- **Directory name:** Lowercase with hyphens (e.g., `frontend/`, `markets/`)
- **Summary file:** Matches directory name exactly (e.g., `frontend.md`, `markets.md`)
- **Detail files:** Prefix with directory name, followed by specific subtopic (e.g., `frontend-architecture.md`, `market-fetcher-discovery.md`)

**Real examples:**

`docs/frontend/`:
- `frontend.md` (summary - links to architecture and component guides)
- `frontend-architecture.md` (file organization, feature modules, import patterns)
- `ui/ui-component-styling.md` (styling, CSS Modules, design system reference)

`docs/markets/`:
- `markets.md` (summary - links to discovery, architecture, operations)
- `market-fetcher-discovery.md` (API discovery workflow, implementation guide)
- `market-system-architecture.md` (data flow, normalization pipeline, calculations)
- `market-system-operations.md` (configuration, monitoring, troubleshooting runbooks)

### Summary Document Requirements

Every documentation directory must include a summary document (e.g., `frontend.md`, `markets.md`) that serves as the entry point for the topic area. This document should:

1. **Lead with audience and purpose** - State who the document is for and what problem domain it covers
2. **Explain why the topic matters** - Describe the risks of ignoring the guidance (the "why" before the "how")
3. **Provide high-level overview** - Summarize core concepts without duplicating detail from linked documents
4. **Link to detailed documents** - Use clear section headers with links and descriptions of what each detailed document covers
5. **Include quick reference** - Provide checklists, common commands, or quick-start workflows
6. **List related topics** - Cross-reference documentation outside the current directory

**Summary document template:**

```markdown
# Topic Name Overview

Brief introduction stating the topic's scope and purpose.

## Who This Document Is For

Target audience description (e.g., "Backend developers implementing market fetchers").

## Why This Matters

- Risk/benefit point 1
- Risk/benefit point 2

## Core System Components

High-level overview of major subsystems or patterns.

**See [topic-name-detail-1.md](./topic-name-detail-1.md) for complete details on:**
- Bullet list of what that document covers
- Specific workflows or patterns explained there

**See [topic-name-detail-2.md](./topic-name-detail-2.md) for complete details on:**
- Different topic area
- Related procedures and guidance

## Quick Reference

Common commands, checklists, or decision matrices.

## Further Reading

**Detailed documentation:**
- [topic-name-detail-1.md](./topic-name-detail-1.md) - Brief description
- [topic-name-detail-2.md](./topic-name-detail-2.md) - Brief description

**Related topics:**
- [other-doc.md](../other-doc.md) - Cross-reference to related documentation
```

### Detailed Document Scope

Each detailed document within a directory should address a single, well-defined concern:

- **Discovery and implementation** - Workflow guidance for adding new components (e.g., `market-fetcher-discovery.md`)
- **Architecture and design** - System structure, data flow, technical patterns (e.g., `frontend-architecture.md`, `market-system-architecture.md`)
- **Operations and runbooks** - Configuration management, monitoring, troubleshooting (e.g., `market-system-operations.md`)
- **Component or pattern reference** - Styling guides, API references, design systems (e.g., `ui-component-styling.md`)

**Avoid duplication between files:**
- Link to related sections instead of repeating content
- Each concept should have one canonical location
- Summary documents provide context; detailed documents provide depth

### Cross-Referencing Patterns

Documentation should link liberally but follow these conventions:

**Within the same directory:**
```markdown
See [frontend-architecture.md](./frontend-architecture.md) for file organization details.
```

**To parent directory documentation:**
```markdown
See [documentation.md](../documentation.md) for writing standards.
```

**To other subdirectories:**
```markdown
See [market-system-architecture.md](../markets/market-system-architecture.md) for pricing calculations.
```

**Always use relative paths** - Do not hardcode repository URLs or absolute paths.

**Provide context in links** - Instead of bare "see here" links, describe what the reader will find:
```markdown
// Good
For detailed API discovery techniques (network inspection, JavaScript analysis), see [market-fetcher-discovery.md](./market-fetcher-discovery.md#discovery-workflow).

// Bad
See market-fetcher-discovery.md for more information.
```

### Migrating Documentation to Directories

When a topic area outgrows a single file and warrants directory-based organization:

1. **Create the new directory** - Use lowercase with hyphens (e.g., `docs/new-topic/`)
2. **Create summary document** - Write `new-topic.md` following the template above
3. **Move or create detailed documents** - Break up content into focused files with consistent naming
4. **Update all cross-references** - Search the codebase for links to old file locations and update to new paths
5. **Update project rules** - Add new documentation paths to `AGENTS.md` and `README.md` rule lists
6. **Verify links** - Ensure all relative paths resolve correctly from the new locations

**Files that typically reference documentation:**
- `AGENTS.md` - Project rules list
- `README.md` - Project overview and quick start
- Other documentation files with cross-references
- Plugin documentation that references core docs
- Migration guides and runbooks

## Final Review

Before publishing, verify that the document:

- Reinforces the style priorities above
- Uses consistent terminology with `@tronrelic/types` and other shared packages
- Keeps the focus on actionable guidance instead of implementation trivia
- Follows the directory organization pattern if part of a multi-document topic area
- Includes proper cross-references using relative paths
- Links to summary documents for topic overviews, not directly to implementation details

Following these guidelines keeps our documentation approachable, keeps readers oriented, and ensures every page answers the question "why should I care?" before diving into detail.
