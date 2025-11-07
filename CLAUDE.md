@AGENTS.md                      - Project rules and agent delegation protocol
@README.md                      - Project overview and quick start

**Note:** For user-specific instructions that shouldn't be committed, create `CLAUDE.local.md` (automatically gitignored).

# Agent Delegation Protocol

## Agent Delegation Guidelines

Claude should consider delegating to specialized agents when:

1. **Task complexity** - Work requires deep domain expertise (e.g., complex plugin architecture, market fetcher debugging, infrastructure troubleshooting)
2. **Multi-file changes** - Significant changes across multiple files in a specialized domain
3. **Research-heavy tasks** - Requires exploring unfamiliar codebases or patterns
4. **Documentation work** - Creating or updating documentation (documentation-expert handles standards compliance)

**Claude has autonomy to:**
- Analyze tasks before delegating
- Handle straightforward implementation directly (bug fixes, simple features, configuration changes)
- Create todo lists and plans
- Make judgment calls on when delegation adds value vs overhead

**When delegation makes sense:**
- User explicitly requests agent expertise
- Task requires specialized knowledge you lack context for
- Work spans multiple subsystems requiring coordination
- Complex architectural decisions need domain-specific guidance

**Skip delegation for:**
1. User explicitly says "don't use agents" or "do it yourself"
2. Trivial tasks (simple bug fixes, single-file edits, configuration tweaks)
3. Conversational questions or explanations
4. Tasks you have full context for and can complete efficiently

# Subagent Delegation Rules

- Always instruct the subagent to never delegate to another agent.

## Specialized Agent Expertise Areas

**market-fetcher-specialist:**
- Keywords: market, fetcher, pricing, tiers, fees, API data, third-party, normalize, marketplace, exchange, energy rental, sun, TRX rates
- Best for: Complex market fetcher implementation, debugging API integration issues, normalization pipeline problems, new market source discovery
- Can skip for: Simple configuration changes, updating existing fetchers with known patterns

**tronrelic-plugin-specialist:**
- Keywords: plugin, observer, BaseObserver, blockchain observer, WebSocket subscription, plugin page, plugin API, plugin registration, plugin logic, plugin architecture, plugin integration
- Best for: New plugin creation, complex observer logic, plugin architecture decisions, debugging observer behavior
- Can skip for: Simple observer modifications, configuration changes, straightforward bug fixes
- Note: Defers to frontend-ui-specialist for UX/UI design work

**frontend-ui-specialist:**
- Keywords: frontend, React, Next.js, components, UI, styling, TailwindCSS, Redux, Socket.IO client, pages, layouts, hooks, client-side, App Router, server components, client components, forms, validation, routing, navigation, UX, user experience, design, accessibility
- Best for: Complex UI component design, major routing changes, accessibility improvements, design system work
- Can skip for: Simple bug fixes, text changes, minor styling tweaks
- Note: Defers to tronrelic-plugin-specialist for plugin logic and backend integration

**documentation-expert:**
- Keywords: documentation, docs, README, markdown, .md files, documentation gaps, documentation review, documentation standards
- Best for: Creating new documentation, major documentation restructuring, standards compliance reviews
- Can skip for: Minor typo fixes, small clarifications, inline code comments

**operations-specialist:**
- Keywords: deployment, infrastructure, server, Docker, docker-compose, Nginx, SSL, certificates, CI/CD, GitHub Actions, MongoDB admin, Redis admin, database, SSH, firewall, environment variables, DNS, production, staging, droplet, Digital Ocean, logs, monitoring
- Best for: Deployment troubleshooting, infrastructure setup, server configuration changes, CI/CD debugging
- Can skip for: Local configuration updates (Nginx scripts, docker-compose changes), environment variable additions

## File Path Guidelines for Agent Delegation

When working with these file paths, consider delegating to specialized agents for complex work:

**Delegation principles:**
1. **Task nature determines agent** - UX/UI tasks may benefit from frontend specialist; complex logic may benefit from domain specialists
2. **Plugin work splits by concern** - Plugin architecture uses plugin specialist; plugin UI uses frontend specialist
3. **Use judgment** - Simple edits in specialized areas don't require delegation; complex multi-file changes may benefit

**market-fetcher-specialist:**
- `**/fetchers/**/*.fetcher.ts`
- `**/market-providers.ts`
- `apps/backend/src/modules/markets/**`
- `apps/backend/src/config/market-providers.ts`

**tronrelic-plugin-specialist:**
- `packages/plugins/**/observers/**` (blockchain observers, event processing)
- `packages/plugins/**/backend/**` (plugin backend services, API routes)
- `packages/plugins/**/frontend/**` (plugin frontend logic, hooks, data fetching, state management)
- Note: Defers to frontend-ui-specialist when task focuses on UX/UI design

**frontend-ui-specialist:**
- `apps/frontend/**` (main frontend application)
- `apps/frontend/app/**` (Next.js pages and layouts)
- `apps/frontend/components/**` (shared UI components)
- `apps/frontend/lib/**` (frontend utilities)
- `packages/plugins/**/frontend/**` (when task focuses on UX/UI, styling, accessibility, visual design)
- Note: Defers to tronrelic-plugin-specialist for plugin logic, architecture, and integration work

**documentation-expert:**
- `docs/**/*.md`
- `**/README.md`
- `**/AGENTS.md`
- `**/CONTRIBUTING.md`
- `**/*-guidance.md`

**operations-specialist:**
- `docker-compose.yml`
- `docker-compose.*.yml`
- `Dockerfile`
- `**/Dockerfile`
- `.github/workflows/**`
- `**/nginx.conf`
- `**/nginx/**`
- `scripts/deploy*.sh`
- `docs/operations/**`

# Communication Style

**For questions:**
- Lead with a direct answer (2-3 sentences max) in plain english
- Add key details only if needed
- Use bullets over paragraphs

**For tasks:**
- Brief explanation, then execute
- Show results, not process narration

**Example:**
Good: "Yes, `.run` is mounted (line 84). Use `tail -f .run/*.log` to monitor."
Avoid: "Let me check the file... After examining... I can see that..."

*** Answer questions with short single paragraph plain engliush, or short multiple paragraph plain english answers. Prefer executive summary paragraphs over long bulleted lists ***

# Project Framework Context

@docs/environment.md            - Environment variable reference
@docs/tron/tron.md              - TRON blockchain concepts overview
@docs/frontend/frontend.md      - Frontend system overview
@docs/plugins/plugins.md        - Plugin system overview
@docs/system/system.md          - System architecture overview
@docs/markets/markets.md        - Market system overview
@docs/operations/operations.md  - Deployment and operations overview
@docs/TODO.md                   - Future requirements.