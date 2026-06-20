/**
 * @fileoverview In-memory registry of notification categories.
 *
 * A category's existence is *code*, declared at boot by its owning source, the
 * same way a hook descriptor is declared — not data. This registry holds the
 * live set for the process lifetime, mirroring how the widgets module keeps its
 * zone registry. Persisted state (admin enable flags, per-user opt-outs, audit)
 * lives in MongoDB and references categories by id; this registry answers "does
 * this category exist right now, and what are its defaults?".
 */

import type { INotificationCategory, NotificationDisposer, ISystemLogService } from '@/types';

/**
 * Holds the registered categories keyed by id. Registration is idempotent per
 * id — re-registering replaces the descriptor so a plugin hot-reload does not
 * duplicate, and returns a disposer the caller invokes on `disable()`.
 */
export class CategoryRegistry {
    private readonly categories = new Map<string, INotificationCategory>();

    /**
     * @param logger - Scoped logger for registration diagnostics.
     */
    constructor(private readonly logger: ISystemLogService) {}

    /**
     * Register (or replace) a category.
     *
     * @param category - The category descriptor a source owns.
     * @returns A disposer that removes this exact descriptor (a no-op if it was
     *          already replaced by a later registration of the same id).
     */
    register(category: INotificationCategory): NotificationDisposer {
        if (this.categories.has(category.id)) {
            this.logger.warn({ categoryId: category.id }, 'Notification category re-registered; replacing prior descriptor');
        }
        this.categories.set(category.id, category);
        this.logger.info({ categoryId: category.id, source: category.source }, 'Notification category registered');

        return () => {
            // Only remove if this exact descriptor is still the live one — a
            // later re-registration owns the slot and must not be dropped by an
            // earlier disposer.
            if (this.categories.get(category.id) === category) {
                this.categories.delete(category.id);
                this.logger.info({ categoryId: category.id }, 'Notification category unregistered');
            }
        };
    }

    /**
     * Look up a category by id.
     *
     * @param id - Category id.
     * @returns The descriptor, or undefined when unregistered.
     */
    get(id: string): INotificationCategory | undefined {
        return this.categories.get(id);
    }

    /**
     * Snapshot of all registered categories — backs the preference and admin UIs.
     *
     * @returns A copy of the current category list.
     */
    list(): INotificationCategory[] {
        return Array.from(this.categories.values());
    }
}
