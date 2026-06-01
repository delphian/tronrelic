/**
 * User Module
 *
 * Better Auth login + profile affordances, wallet display, and the
 * `/system/users` admin dashboards (account directory, traffic analytics,
 * Google Search Console). Better Auth is the sole identity layer — the
 * legacy UUID identity slice, cookie utilities, TronLink wallet hook, and
 * public profile subtree were removed in the Phase 6 cutover.
 *
 * ## Directory Structure
 *
 * ```
 * modules/user/
 * ├── index.ts          # Barrel exports (this file)
 * ├── api/              # Admin analytics + GSC client
 * ├── components/       # AuthModal, WalletButton, ProfileMenu, SessionProvider, admin/*
 * └── lib/              # Better Auth client + SSR session resolver
 * ```
 */

// =============================================================================
// Components — Better Auth login + profile
// =============================================================================

export { WalletButton } from './components';
export { SessionProvider, useAuthSession } from './components';
export type { IAuthSessionContext, ISessionProviderProps } from './components';
export { AuthModal } from './components';
export type { IAuthModalProps } from './components';
export { ProfileMenu } from './components';
export type { IProfileMenuProps } from './components';

// =============================================================================
// Components — `/system/users` admin dashboards
// =============================================================================

export { UsersMonitor } from './components';
export { VisitorAnalytics } from './components';
export { PageActivity } from './components';
export { AnalyticsDashboard } from './components';
export { GscSettings } from './components';
export { GroupsManager } from './components';
export { TrafficDashboard } from './components';

// =============================================================================
// Better Auth client
// =============================================================================

export { authClient, useSession, signIn, signOut, signUp } from './lib';
export type { ISSRSession } from './lib';
