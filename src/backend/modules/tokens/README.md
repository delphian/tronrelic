# Tokens

`TokensService` owns the `sunpump_tokens` collection and serves recently created SunPump tokens (name, symbol, contract, owner) through a Redis-cached read path.

## Canonical documentation

No dedicated detail doc exists yet; [system-database.md](../../../../docs/system/system-database.md) covers the `IDatabaseService` and caching patterns this module follows (register model, cache-then-query). Scope is narrow and self-contained: one collection, one read endpoint (`GET` recent SunPump tokens via `TokensController.sunpumpRecent`), no writes exposed to callers.
