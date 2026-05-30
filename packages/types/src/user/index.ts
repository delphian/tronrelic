/**
 * User-group types. The legacy UUID identity surface (IUser, IUserService,
 * IUserIdentityState, IUserFilter, IAuthStatus and their summary/history
 * types) was removed in the Better Auth cutover (@delphian/tronrelic-types
 * 3.0.0). Identity now flows through the published `identity` services
 * (IAccountDirectoryService, IWalletService) and `IUserGroupService`.
 */

export type {
    IUserGroup,
    ICreateUserGroupInput,
    IUpdateUserGroupInput
} from './IUserGroup.js';

export type { IUserGroupService } from './IUserGroupService.js';
