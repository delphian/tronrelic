/**
 * @file ai-provider-registry.ts
 *
 * In-memory registry of installed AI provider plugins. Provider plugins register
 * themselves on enable and unregister on disable; the admin Provider panel reads
 * the metadata list and core surfaces actuate the active provider through its
 * executable instance. State is in-memory (rebuilt from registrations each boot)
 * because a provider's presence is a runtime fact tied to whether its plugin is
 * enabled, not persistent configuration.
 */

import type { IAiProvider, IAiProviderInfo, IAiProviderRegistry, ISystemLogService } from '@/types';

/**
 * One registered provider: its self-reported metadata paired with the executable
 * instance core invokes when the provider is active.
 */
interface IRegisteredProvider {
    /** The provider's self-reported metadata for the admin Provider panel. */
    info: IAiProviderInfo;
    /** The provider's executable service, returned by {@link AiProviderRegistry.getActive}. */
    instance: IAiProvider;
}

/**
 * Core-owned, provider-neutral registry of AI provider plugins. Holds each
 * provider's metadata for display and its executable instance for actuation, so
 * a core surface can run a query against "whatever provider is active" without
 * binding to a vendor service key.
 */
export class AiProviderRegistry implements IAiProviderRegistry {
    /** Registered providers keyed by provider id. */
    private readonly providers = new Map<string, IRegisteredProvider>();

    /**
     * @param logger - Module-scoped logger for registration diagnostics.
     */
    constructor(private readonly logger: ISystemLogService) {}

    /** @inheritdoc */
    registerProvider(info: IAiProviderInfo, instance: IAiProvider): void {
        this.providers.set(info.id, { info, instance });
        this.logger.info({ provider: info.id, active: info.active }, `AI provider registered: ${info.id}`);
    }

    /** @inheritdoc */
    unregisterProvider(id: string): boolean {
        const removed = this.providers.delete(id);
        if (removed) {
            this.logger.info({ provider: id }, `AI provider unregistered: ${id}`);
        }
        return removed;
    }

    /** @inheritdoc */
    listProviders(): IAiProviderInfo[] {
        return Array.from(this.providers.values(), (entry) => entry.info);
    }

    /** @inheritdoc */
    getActive(): IAiProvider | null {
        for (const entry of this.providers.values()) {
            if (entry.info.active) {
                return entry.instance;
            }
        }
        return null;
    }

    /** @inheritdoc */
    getProvider(id: string): IAiProvider | null {
        return this.providers.get(id)?.instance ?? null;
    }
}
