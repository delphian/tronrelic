/**
 * Profile components barrel export.
 *
 * Note: ProfilePage is a server component and must be imported directly
 * from './ProfilePage' to avoid bundling issues with client components.
 */

export type { IPublicProfile as ProfileData } from '../../api';
export { ProfileOwnerView } from './ProfileOwnerView';
export { ProfilePublicView } from './ProfilePublicView';
