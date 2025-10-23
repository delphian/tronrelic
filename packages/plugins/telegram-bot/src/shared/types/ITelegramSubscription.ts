/**
 * Represents a notification subscription type available to users.
 * Future feature: allows dynamic configuration of what notifications can be subscribed to.
 */
export interface ITelegramSubscription {
    /**
     * Unique identifier for this subscription type (e.g., 'whale-alerts').
     */
    id: string;

    /**
     * Human-readable name displayed to users.
     */
    name: string;

    /**
     * Description of what notifications this subscription provides.
     */
    description: string;

    /**
     * Whether this subscription type is currently active.
     * Inactive subscriptions cannot be subscribed to.
     */
    enabled: boolean;

    /**
     * Order in which to display this subscription type (lower numbers first).
     */
    sortOrder: number;
}
