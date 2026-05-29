/**
 * @fileoverview Public API for the identity module.
 *
 * Better Auth + everything BA-keyed: the auth instance and facade, group
 * membership, the BA-user-keyed wallet store, group definitions, and the
 * read-only account directory. Consumers import from this barrel rather than
 * reaching into module internals.
 */

export { IdentityModule } from './IdentityModule.js';
export type { IIdentityModuleDependencies } from './IdentityModule.js';

export { GroupService, ADMIN_GROUP_ID } from './services/group.service.js';
export { UserGroupService, SYSTEM_ADMIN_GROUP_ID } from './services/user-group.service.js';
export { WalletService, WALLETS_COLLECTION } from './services/wallet.service.js';
export type { WalletAction, IWalletMutationInput } from './services/wallet.service.js';
export { WalletChallengeService } from './services/wallet-challenge.service.js';
export type { IWalletChallenge, WalletChallengeAction } from './services/wallet-challenge.service.js';
export { AccountDirectoryService } from './services/account-directory.service.js';
export { AUTH_USERS_COLLECTION, AUTH_COLLECTIONS } from './services/auth-constants.js';
export { createAuth, type Auth } from './auth.js';

export { UserGroupController } from './api/user-group.controller.js';
export { WalletController } from './api/wallet.controller.js';
export { createAdminUserGroupRouter } from './api/user-group.routes.js';
export { createWalletRouter } from './api/wallet.routes.js';

export type { IWalletDocument, ILinkedWallet } from './database/IWalletDocument.js';
export type { IUserGroupDocument } from './database/IUserGroupDocument.js';
