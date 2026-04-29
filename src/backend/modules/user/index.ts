export { UserModule } from './UserModule.js';
export { UserService, UserGroupService, RESERVED_ADMIN_PATTERN, SYSTEM_ADMIN_GROUP_ID, computeUserAuthStatus, withAuthStatus } from './services/index.js';
export type { IUserStats } from './services/index.js';
export type {
    IUserDocument,
    IUserGroupDocument,
    IWalletLink,
    IUserPreferences,
    IUserActivity,
    ICreateUserInput,
    ILinkWalletInput,
    IUser
} from './database/index.js';
