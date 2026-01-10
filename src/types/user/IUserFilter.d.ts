/**
 * Available user filter types for admin dashboard.
 *
 * USER_FILTERS is the single source of truth - the type is derived from it.
 * Used by both backend (MongoDB query building) and frontend (filter dropdown).
 */
export declare const USER_FILTERS: readonly ["all", "live-now", "power-users", "one-time", "returning", "long-sessions", "verified-wallet", "multi-wallet", "no-wallet", "recently-connected", "active-today", "active-week", "churned", "new-users", "mobile-users", "desktop-users", "multi-device", "screen-mobile-sm", "screen-mobile-md", "screen-mobile-lg", "screen-tablet", "screen-desktop", "screen-desktop-lg", "multi-region", "single-region", "feature-explorers", "focused-users", "referred-traffic", "high-value", "at-risk", "conversion-candidates"];
/**
 * User filter type derived from USER_FILTERS array.
 */
export type UserFilterType = (typeof USER_FILTERS)[number];
//# sourceMappingURL=IUserFilter.d.ts.map