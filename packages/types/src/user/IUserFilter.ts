/**
 * Available user filter types for admin dashboard.
 *
 * Used by both backend (MongoDB query building) and frontend (filter dropdown).
 */
export type UserFilterType =
    | 'all'
    // Engagement
    | 'power-users'
    | 'one-time'
    | 'returning'
    | 'long-sessions'
    // Wallet Status
    | 'verified-wallet'
    | 'multi-wallet'
    | 'no-wallet'
    | 'recently-connected'
    // Temporal
    | 'active-today'
    | 'active-week'
    | 'churned'
    | 'new-users'
    // Device
    | 'mobile-users'
    | 'desktop-users'
    | 'multi-device'
    // Geographic
    | 'multi-region'
    | 'single-region'
    // Behavioral
    | 'feature-explorers'
    | 'focused-users'
    | 'referred-traffic'
    // Quick Picks (compound)
    | 'high-value'
    | 'at-risk'
    | 'conversion-candidates';
