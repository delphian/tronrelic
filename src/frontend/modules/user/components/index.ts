/**
 * User module components barrel export.
 *
 * Better Auth login + profile affordances and the `/system/users` admin
 * dashboards. The legacy UUID identity provider and the public profile
 * subtree were removed in the Phase 6 cutover.
 */

export { WalletButton } from './WalletButton';
export { SessionProvider, useAuthSession } from './SessionProvider';
export type { IAuthSessionContext, ISessionProviderProps } from './SessionProvider';
export { AuthModal } from './AuthModal';
export type { IAuthModalProps } from './AuthModal';
export { ProfileMenu } from './ProfileMenu';
export type { IProfileMenuProps } from './ProfileMenu';

// Admin components — identity only; traffic panels live in modules/traffic
export { UsersMonitor } from './admin';
export { GroupsManager } from './admin';
