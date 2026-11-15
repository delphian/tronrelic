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

export type { SignupCapMode } from './SignupCapMode.js';
export type { EmailDomainRuleAction } from './EmailDomainRuleAction.js';
export type { IEmailDomainRule } from './IEmailDomainRule.js';
export type { ISignupCapConfig } from './ISignupCapConfig.js';
export type { ISignupProtectionConfig } from './ISignupProtectionConfig.js';
export type { ISignupCapStatus } from './ISignupCapStatus.js';
export type { ISignupRefusalCount } from './ISignupRefusalCount.js';
export type { IEmailDomainActivity } from './IEmailDomainActivity.js';
export type { ISignupProtectionReport } from './ISignupProtectionReport.js';
export { SIGNUP_PROTECTION_LIMITS } from './SIGNUP_PROTECTION_LIMITS.js';
export { SIGNUP_REFUSAL_REASONS } from './SIGNUP_REFUSAL_REASONS.js';
export { normalizeEmailDomain } from './normalizeEmailDomain.js';
