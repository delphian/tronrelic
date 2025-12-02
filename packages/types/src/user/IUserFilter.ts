/**
 * Available user filter types for admin dashboard.
 *
 * USER_FILTERS is the single source of truth - the type is derived from it.
 * Used by both backend (MongoDB query building) and frontend (filter dropdown).
 */
export const USER_FILTERS = [
    'all',
    // Real-time
    'live-now',
    // Engagement
    'power-users',
    'one-time',
    'returning',
    'long-sessions',
    // Wallet Status
    'verified-wallet',
    'multi-wallet',
    'no-wallet',
    'recently-connected',
    // Temporal
    'active-today',
    'active-week',
    'churned',
    'new-users',
    // Device
    'mobile-users',
    'desktop-users',
    'multi-device',
    // Screen Size (based on viewport width breakpoints)
    'screen-mobile-sm',   // < 360px (legacy devices)
    'screen-mobile-md',   // 360-479px (primary mobile)
    'screen-mobile-lg',   // 480-767px (large phones)
    'screen-tablet',      // 768-1023px (tablets)
    'screen-desktop',     // 1024-1199px (standard desktop)
    'screen-desktop-lg',  // >= 1200px (large desktop)
    // Geographic
    'multi-region',
    'single-region',
    // Behavioral
    'feature-explorers',
    'focused-users',
    'referred-traffic',
    // Quick Picks (compound)
    'high-value',
    'at-risk',
    'conversion-candidates'
] as const;

/**
 * User filter type derived from USER_FILTERS array.
 */
export type UserFilterType = (typeof USER_FILTERS)[number];
