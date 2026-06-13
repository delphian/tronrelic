/**
 * @file ai-provider-registry.ts
 *
 * In-memory registry of installed AI provider plugins. Provider plugins register
 * themselves on enable and unregister on disable; the admin Provider panel reads
 * the list. State is in-memory (rebuilt from registrations each boot) because a
 * provider's presence is a runtime fact tied to whether its plugin is enabled,
 * not persistent configuration.
 */

import type { IAiProviderInfo, IAiProviderRegistry, ISystemLogService } from '@/types';

/**
 * Core-owned, provider-neutral registry of AI provider plugins.
 */
export class AiProviderRegistry implements IAiProviderRegistry {
    /** Registered providers keyed by provider id. */
    private readonly providers = new Map<string, IAiProviderInfo>();

    /**
     * @param logger - Module-scoped logger for registration diagnostics.
     */
    constructor(private readonly logger: ISystemLogService) {}

    /** @inheritdoc */
    registerProvider(info: IAiProviderInfo): void {
        this.providers.set(info.id, info);
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
        return Array.from(this.providers.values());
    }
}
