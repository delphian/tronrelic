/**
 * User module components barrel export.
 *
 * Better Auth login, the profile settings hub (ProfileView, WalletManager,
 * ProfileAuthGate), and the `/system/users` admin dashboards. The legacy
 * UUID identity provider was removed in the Phase 6 cutover.
 */

export { WalletButton } from './WalletButton';
export { SessionProvider, useAuthSession } from './SessionProvider';
export type { IAuthSessionContext, ISessionProviderProps } from './SessionProvider';
export { AuthModal } from './AuthModal';
export type { IAuthModalProps } from './AuthModal';

// Admin components — identity only; traffic panels live in modules/traffic
export { UsersMonitor } from './admin';
export { GroupsManager } from './admin';
