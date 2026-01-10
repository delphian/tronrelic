# Telegram Bot Plugin TODO

## Inter-Plugin Communication Pattern

**Context:** The telegram bot currently needs to access market data from the resource-markets plugin. Currently implemented via HTTP call to `/api/plugins/resource-markets/markets`, but this creates tight coupling and doesn't leverage the plugin dependency injection system.

**Problem:** Plugins should be able to discover and consume services from other plugins without making HTTP requests. HTTP calls:
- Create network overhead for internal communication
- Bypass the dependency injection system
- Don't benefit from type safety
- Can't leverage shared context or state
- Make testing more complex (requires API mocking)

**Proposed solution:** Implement a plugin service registry where plugins can export typed services that other plugins can inject via their context:

```typescript
// In resource-markets plugin backend
export const resourceMarketsPlugin = definePlugin({
    manifest: resourceMarketsManifest,

    services: {
        // Export market service for other plugins to use
        markets: marketService
    },

    init: async (context) => {
        // ...
    }
});

// In telegram-bot plugin backend
export const telegramBotPlugin = definePlugin({
    manifest: telegramBotManifest,

    dependencies: ['resource-markets'], // Declare plugin dependencies

    init: async (context) => {
        // Access market service via plugin context
        const marketService = context.plugins['resource-markets'].services.markets;

        // Use service directly instead of HTTP calls
        const markets = await marketService.getAllMarkets();
    }
});
```

**Benefits:**
- Type-safe plugin-to-plugin communication
- No HTTP overhead for internal calls
- Leverages dependency injection patterns
- Explicit dependency declarations
- Easier testing with service mocks
- Proper initialization ordering based on dependencies

**Implementation tasks:**
1. Design plugin service registry interface
2. Update plugin context to include plugin service access
3. Add dependency resolution to plugin loader
4. Update telegram-bot to use service injection instead of HTTP
5. Document inter-plugin communication patterns

**Temporary workaround:** Continue using HTTP endpoint `/api/plugins/resource-markets/markets` until service registry is implemented.
