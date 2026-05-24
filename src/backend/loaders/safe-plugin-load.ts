import type { IPlugin } from '@/types';

/**
 * Safely materializes a list of plugin-loading thunks into a `IPlugin[]`.
 *
 * Why this exists separately from `plugins.generated.ts`: the generated file
 * is rewritten on every plugin scan and cannot host tests. Extracting the
 * failure-isolation orchestration here keeps the contract testable and gives
 * the auto-generated registry a single, audited helper to call.
 *
 * Failure contract: any loader that rejects or whose resolved value lacks the
 * minimum IPlugin shape (an object with a `manifest.id` string) is dropped
 * from the returned set, with a structured log entry. The remaining plugins
 * still load. This is the failure-isolation guarantee that backend startup
 * relies on — a single broken plugin must not abort `loadPlugins()`.
 */
export interface IPluginLoadFailure {
    /** Index of the failed loader in the input array. Useful for surfacing
        ordering-stable diagnostics in admin UIs. */
    index: number;
    /** Reason — either the thrown error or a shape-validation message. */
    reason: unknown;
}

/**
 * Returns true when `value` has the minimum IPlugin shape: a manifest object
 * with a non-empty string id. Title and version are validated by downstream
 * consumers (metadata registration enforces them), so this predicate only
 * gates what loadDiscoveredPlugins itself needs to safely pass the value
 * onward.
 */
export function isMinimalIPlugin(value: unknown): value is IPlugin {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    if (typeof v.manifest !== 'object' || v.manifest === null) return false;
    const m = v.manifest as Record<string, unknown>;
    return typeof m.id === 'string' && m.id.length > 0;
}

/**
 * Runs every loader, collects the successful IPlugin results, and reports
 * the failures. Loaders are awaited in parallel via Promise.allSettled so a
 * single hung dynamic import can't stall the rest — and so each loader's
 * exception is captured rather than aborting the chain.
 *
 * The optional `onFailure` callback is invoked once per dropped plugin;
 * loaders that omit it still get a console.error. Tests inject the callback
 * to assert which plugins were rejected and why.
 */
export async function loadFromPluginLoaders(
    loaders: ReadonlyArray<() => Promise<unknown>>,
    onFailure?: (failure: IPluginLoadFailure) => void
): Promise<IPlugin[]> {
    const results = await Promise.allSettled(loaders.map(load => load()));
    const plugins: IPlugin[] = [];

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const failure: IPluginLoadFailure = { index, reason: result.reason };
            if (onFailure) {
                onFailure(failure);
            } else {
                console.error('[plugins.generated] Plugin failed to load:', result.reason);
            }
            return;
        }

        if (!isMinimalIPlugin(result.value)) {
            const failure: IPluginLoadFailure = {
                index,
                reason: new Error(
                    'Resolved value is not a minimum IPlugin shape (missing manifest.id).'
                )
            };
            if (onFailure) {
                onFailure(failure);
            } else {
                console.error('[plugins.generated] Plugin failed shape validation at index', index);
            }
            return;
        }

        plugins.push(result.value);
    });

    return plugins;
}
