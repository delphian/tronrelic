/**
 * User-group types. Identity flows through the published `identity` services
 * (IAccountDirectoryService, IWalletService) and `IUserGroupService`.
 */

export type {
    IUserGroup,
    ICreateUserGroupInput,
    IUpdateUserGroupInput
} from './IUserGroup.js';

export type { IUserGroupService } from './IUserGroupService.js';
