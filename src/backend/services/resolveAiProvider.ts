/**
 * @fileoverview Pick the AI provider an admin-configured feature should call.
 *
 * Several admin features let an administrator choose which installed provider
 * and model run their AI requests, such as the localization module's
 * translation suggestions and the pages module's page translation
 * suggestions. They all need the same rule for turning that choice into a
 * provider, so the rule lives here once.
 *
 * The provider always comes from the core `'ai-providers'` registry, never
 * from a vendor's own service name, so a feature keeps working when a
 * different provider plugin is installed.
 *
 * @module backend/services/resolveAiProvider
 */

import type { IAiProvider, IAiProviderRegistry } from '@/types';

/** How a feature describes itself in the refusals this helper raises. */
export interface IAiFeatureWording {
    /** What the feature is called in a sentence, such as `translation suggestions`. */
    featureName: string;
    /** Where the administrator chooses the provider, such as `the Settings tab`. */
    settingsLocation: string;
}

/**
 * Resolve the provider an administrator chose, or the active provider when
 * they chose none.
 *
 * A named provider that is no longer installed is a refusal rather than a
 * silent fallback to the active provider, because the administrator chose
 * that provider and its model on purpose, and the model id may mean nothing to
 * a different vendor.
 *
 * @param registry - The core provider registry, or null when it is not published.
 * @param providerId - The chosen provider's registry id, or null for the active provider.
 * @param wording - How the calling feature names itself and its settings, for the refusal text.
 * @param unavailable - Builds the caller's own error type, so its HTTP layer can
 *   report "no provider" with the status it already uses for that case.
 * @returns The provider instance and its registry id.
 * @throws The error `unavailable` builds when no usable provider exists.
 */
export function resolveAiProvider(
    registry: IAiProviderRegistry | null,
    providerId: string | null,
    wording: IAiFeatureWording,
    unavailable: (message: string) => Error
): { provider: IAiProvider; providerId: string } {
    if (!registry) {
        throw unavailable(`No AI provider is installed. Enable an AI provider plugin to use ${wording.featureName}.`);
    }

    let provider: IAiProvider | null;
    let resolvedId: string | undefined;
    if (providerId) {
        provider = registry.getProvider(providerId);
        resolvedId = providerId;
        if (!provider) {
            throw unavailable(
                `The AI provider "${providerId}" chosen on ${wording.settingsLocation} is not installed. Choose another on ${wording.settingsLocation}.`
            );
        }
    } else {
        provider = registry.getActive();
        resolvedId = registry.listProviders().find(info => info.active)?.id;
        if (!provider || !resolvedId) {
            throw unavailable(`No AI provider is active. Enable an AI provider plugin to use ${wording.featureName}.`);
        }
    }

    return { provider, providerId: resolvedId };
}
