/**
 * @file variables/index.ts
 *
 * Registers the core-owned built-in dynamic prompt variables into the
 * `'prompt-variables'` registry. These were previously registered by the
 * trp-ai-assistant plugin through `IPluginContext`; ownership moved to the
 * ai-tools module so the variables exist for whichever AI provider is installed
 * (or none) and so the lethal-trifecta detector sees them regardless of which
 * provider plugin is enabled.
 *
 * Plugins keep the ability to register their own dynamic variables the same way —
 * by watching the `'prompt-variables'` service and calling `registerVariable` —
 * this module simply owns the built-in set.
 */

import type { IPromptVariableRegistry } from '@/types';
import type { IBuiltinVariableDeps } from './types.js';
import { registerBlockchainVariables } from './blockchain.js';
import { registerSystemHealthVariables } from './system-health.js';
import { registerSiteContentVariables } from './site-content.js';
import { registerDatabaseAccessVariables } from './database-access.js';

export type { IBuiltinVariableDeps } from './types.js';

/**
 * Register every built-in dynamic variable on the registry. Idempotent —
 * `registerVariable` replaces by name — so it is safe to call once at module
 * `init()`. The resolvers close over `deps` and read them lazily at expansion
 * time, so the services need only exist (be constructed), not be fully warmed,
 * when this runs.
 *
 * @param registry - The core prompt-variable registry.
 * @param deps - Injected core services the resolvers read at expansion time.
 */
export function registerBuiltinVariables(
    registry: IPromptVariableRegistry,
    deps: IBuiltinVariableDeps
): void {
    registerBlockchainVariables(registry, deps);
    registerSystemHealthVariables(registry, deps);
    registerSiteContentVariables(registry, deps);
    registerDatabaseAccessVariables(registry, deps);
}
