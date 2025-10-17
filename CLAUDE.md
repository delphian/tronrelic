@AGENTS.md                      - Project rules and agent delegation protocol
@README.md                      - Project overview and quick start
@docs/environment.md            - Environment variable reference
@docs/tron/tron.md              - TRON blockchain concepts overview
@docs/frontend/frontend.md      - Frontend system overview
@docs/plugins/plugins.md        - Plugin system overview
@docs/system/system.md          - System architecture overview
@docs/markets/markets.md        - Market system overview
@docs/operations/operations.md  - Deployment and operations overview
@docs/TODO.md                   - Future requirements.

# Agent Delegation Protocol

## MANDATORY: Check Delegation BEFORE Any Implementation

When a task involves implementation work (keywords: "implement", "create", "build", "add", "update", "write code", "make changes"), Claude MUST:

1. **STOP** - Do not create todo lists, plans, or start implementation
2. **CHECK** - Scan for agent trigger keywords in the request
3. **DELEGATE** - If keywords match, delegate immediately

Response format:

"I'm analyzing this task... [brief analysis]

**Agent delegation check:**
- Task involves: [market fetchers/plugins/documentation/etc]
- Appropriate agent: [agent-name]
- Launching `[agent-name]` agent now..."

[Then use Task tool]

**Only skip agent delegation if:**
1. User explicitly says "don't use agents" or "do it yourself"
2. Task is trivial (< 5 lines of code, single file read)
3. Task is purely conversational

**If you skip delegation, explicitly state which condition applies.**

# Subagent Delegation Rules

## Trigger Keywords

**market-fetcher-specialist:**
- Keywords: market, fetcher, pricing, tiers, fees, API data, third-party, normalize, marketplace, exchange, energy rental, sun, TRX rates
- Use for: ANY work involving market data fetchers, including analysis, investigation, research, creation, updates, troubleshooting, or debugging

**tronrelic-plugin-specialist:**
- Keywords: plugin, observer, BaseObserver, blockchain observer, WebSocket subscription, plugin page, plugin API, plugin registration, plugin logic, plugin architecture, plugin integration
- Use for: ANY work involving TronRelic plugin logic, architecture, and integration (analysis, investigation, research, creation, debugging, architecture decisions, code review)
- Scope: PRIMARY agent for plugin tooling, logic, organization, communication, backend services, and system integration. Defers to frontend-specialist for UX/UI design work
- Exception: Work on the general plugin system infrastructure should NOT be handled by this subagent

**frontend-specialist:**
- Keywords: frontend, React, Next.js, components, UI, styling, TailwindCSS, Redux, Socket.IO client, pages, layouts, hooks, client-side, App Router, server components, client components, forms, validation, routing, navigation, UX, user experience, design, accessibility
- **Mandatory triggers** (always delegate): URL structure changes, navigation components, routing implementation, layout creation, authentication UI, context providers
- Use for: ALL UX/UI work across TronRelic (component design, styling, user experience, accessibility, visual design)
- Scope: PRIMARY agent for user experience and visual design regardless of location (apps/frontend OR packages/plugins/*/frontend). Defers to tronrelic-plugin-specialist for plugin logic, architecture, and system integration
- Exception: Work on general Next.js infrastructure or build configuration may not require this subagent

**documentation-writer:**
- Keywords: documentation, docs, README, markdown, .md files, documentation gaps, documentation review, documentation standards
- Use for: ANY work involving project documentation (analysis, investigation, creation, updates, reviews, improvements)
- **MANDATORY DELEGATION:** If the conversation involves ANY documentation work (analyzing gaps, reading docs to evaluate changes, creating/updating/reviewing .md files), ALWAYS delegate to documentation-writer BEFORE doing any analysis or file operations yourself. This applies even if the task seems trivial or you're in the middle of other work. Documentation work is never self-handled.

**operations-specialist:**
- Keywords: deployment, infrastructure, server, Docker, docker-compose, Nginx, SSL, certificates, CI/CD, GitHub Actions, MongoDB admin, Redis admin, database, SSH, firewall, environment variables, DNS, production, staging, droplet, Digital Ocean, logs, monitoring
- Use for: Deployment issues, infrastructure setup, server management, CI/CD pipelines, database administration, SSL configuration, troubleshooting production/staging environments

## Automatic Agent Delegation by File Path

Claude MUST automatically use these agents when working with these file paths.

**Delegation principles:**
1. **Task nature determines agent** - UX/UI tasks use frontend specialist regardless of file location; logic/integration tasks use domain specialists
2. **Plugin work splits by concern** - Plugin logic/architecture uses plugin specialist; plugin UX/UI uses frontend specialist
3. **When unclear** - Analyze the task description for keywords (styling/UX → frontend; logic/integration → domain specialist)

**market-fetcher-specialist:**
- `**/fetchers/**/*.fetcher.ts`
- `**/market-providers.ts`
- `apps/backend/src/modules/markets/**`
- `apps/backend/src/config/market-providers.ts`

**tronrelic-plugin-specialist:**
- `packages/plugins/**/observers/**` (blockchain observers, event processing)
- `packages/plugins/**/backend/**` (plugin backend services, API routes)
- `packages/plugins/**/frontend/**` (plugin frontend logic, hooks, data fetching, state management)
- Note: Defers to frontend-specialist when task focuses on UX/UI design

**frontend-specialist:**
- `apps/frontend/**` (main frontend application)
- `apps/frontend/app/**` (Next.js pages and layouts)
- `apps/frontend/components/**` (shared UI components)
- `apps/frontend/lib/**` (frontend utilities)
- `packages/plugins/**/frontend/**` (when task focuses on UX/UI, styling, accessibility, visual design)
- Note: Defers to tronrelic-plugin-specialist for plugin logic, architecture, and integration work

**documentation-writer:**
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

**Exception:** If the user explicitly says "don't use agents" or "do it yourself", skip delegation.

# Communication Style

**NOTE:** Communication style guidelines apply AFTER agent delegation is resolved. If a task requires delegation, the delegation protocol takes precedence over brevity.

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