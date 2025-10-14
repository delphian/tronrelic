@AGENTS.md
@README.md

# Agent Delegation Protocol

When a task arrives, Claude MUST respond with:

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

# Subagent Delegation Rules

## Trigger Keywords

**market-fetcher-specialist:**
- Keywords: market, fetcher, pricing, tiers, fees, API data, third-party, normalize, marketplace, exchange, energy rental, sun, TRX rates
- Use for: ANY work involving market data fetchers, including analysis, investigation, research, creation, updates, troubleshooting, or debugging

**tronrelic-plugin-specialist:**
- Keywords: plugin, observer, BaseObserver, blockchain observer, WebSocket subscription, plugin page, plugin API, plugin registration
- Use for: ANY work involving TronRelic plugins (analysis, investigation, research, creation, debugging, architecture decisions, code review)
- Exception: Work on the general plugin system infrastructure should NOT be handled by this subagent

**documentation-writer:**
- Keywords: documentation, docs, README, markdown, .md files, documentation gaps, documentation review, documentation standards
- Use for: ANY work involving project documentation (analysis, investigation, creation, updates, reviews, improvements)

## Automatic Agent Delegation by File Path

Claude MUST automatically use these agents when working with these file paths:

**market-fetcher-specialist:**
- `**/fetchers/**/*.fetcher.ts`
- `**/market-providers.ts`
- `apps/backend/src/modules/markets/**`
- `apps/backend/src/config/market-providers.ts`

**tronrelic-plugin-specialist:**
- `packages/plugins/**/observers/**`
- `packages/plugins/**/backend/**`
- `packages/plugins/**/frontend/**`

**documentation-writer:**
- `docs/**/*.md`
- `**/README.md`
- `**/AGENTS.md`
- `**/CONTRIBUTING.md`
- `**/*-guidance.md`

**Exception:** If the user explicitly says "don't use agents" or "do it yourself", skip delegation.