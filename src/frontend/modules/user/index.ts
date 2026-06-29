/**
 * User Module
 *
 * Better Auth login, the `/profile` settings hub (wallet management via
 * TronLink signing, notification preferences), and the `/system/users`
 * identity dashboards (account directory, groups). Better Auth is the sole
 * identity layer — the legacy UUID identity slice and its cookie utilities
 * were removed in the Phase 6 cutover. Traffic analytics and the GSC
 * integration moved to `modules/traffic` to mirror the backend
 * identity/traffic split.
 *
 * ## Directory Structure
 *
 * ```
 * modules/user/
 * ├── index.ts          # Barrel exports (this file)
 * ├── components/       # AuthModal, WalletButton, ProfileView, SessionProvider, admin/*
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

// =============================================================================
// Components — `/system/users` identity dashboards
// =============================================================================

export { UsersMonitor } from './components';
export { GroupsManager } from './components';

// =============================================================================
// Better Auth client
// =============================================================================

export { authClient, useSession, signIn, signOut, signUp } from './lib';
export type { ISSRSession } from './lib';
