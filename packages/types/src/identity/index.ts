/**
 * @fileoverview Barrel for identity-domain published service contracts.
 *
 * These interfaces describe the services the identity module registers on the
 * service registry (`'wallets'`, `'accounts'`). The Better Auth-keyed group
 * contract (`IUserGroupService`, registered as `'user-groups'`) currently
 * lives under `../user` and is re-exported from the top-level barrel; it moves
 * here when the legacy user types are removed.
 */

export type {
    IWalletService,
    ILinkedWallet,
    WalletAction,
    IWalletChallenge,
    IWalletMutationInput
} from './IWalletService.js';

export type {
    IAccountDirectoryService,
    IAccountSummary,
    IAccountMatch,
    IListAccountsOptions,
    IListAccountsResult
} from './IAccountDirectoryService.js';

export type {
    IUserSettingsService,
    IUserSettingDefinition
} from './IUserSettingsService.js';

export type { IConnectedApp } from './IConnectedApp.js';
export type { IConnectedAppAdminRow } from './IConnectedAppAdminRow.js';
export type { IConnectedAppsService } from './IConnectedAppsService.js';
export type { IOAuthConsentContext } from './IOAuthConsentContext.js';
