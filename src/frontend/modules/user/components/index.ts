/**
 * User module components barrel export.
 *
 * Note: ProfilePage is a server component and must be imported directly
 * from './Profile/ProfilePage' to avoid bundling issues with client components.
 */

export { UserIdentityProvider } from './UserIdentityProvider';
export type { UserIdentityProviderProps } from './UserIdentityProvider';
export { WalletButton } from './WalletButton';
export { SessionProvider, useAuthSession } from './SessionProvider';
export type { IAuthSessionContext, ISessionProviderProps } from './SessionProvider';
export { AuthModal } from './AuthModal';
export type { IAuthModalProps } from './AuthModal';
export { ProfileMenu } from './ProfileMenu';
export type { IProfileMenuProps } from './ProfileMenu';
export { ProfileOwnerView, ProfilePublicView } from './Profile';
export type { ProfileData } from './Profile';

// Admin components
export { UsersMonitor } from './admin';
export { VisitorAnalytics } from './admin';
export { AnalyticsDashboard } from './admin';
export { ReferralOverview } from './admin';
export { GscSettings } from './admin';
export { GroupsManager } from './admin';
export { TrafficDashboard } from './admin';
