/**
 * User module components barrel export.
 *
 * Note: ProfilePage is a server component and must be imported directly
 * from './Profile/ProfilePage' to avoid bundling issues with client components.
 */

export { UserIdentityProvider } from './UserIdentityProvider';
export type { UserIdentityProviderProps } from './UserIdentityProvider';
export { WalletButton } from './WalletButton';
export { ProfileOwnerView, ProfilePublicView } from './Profile';
export type { ProfileData } from './Profile';

// Admin components
export { UsersMonitor } from './admin';
