/**
 * @file end-user-resolver.ts
 *
 * Resolves a Better Auth user id into the trusted end-user principal the
 * governor scopes user-owned-object tools to. Both query entry points need this
 * conversion — the admin route from the request's authenticated user, the
 * scheduled-prompts runner from a saved prompt's recorded owner — so the logic
 * lives once here and is injected into both rather than duplicated.
 *
 * Resolution always reads live account state through the identity module's
 * `'accounts'` service (the only sanctioned reader of the Better Auth user
 * collection), so a principal carries the owner's *current* groups, email, and
 * primary wallet — never a stale snapshot captured when a prompt was saved. A
 * deleted or unresolvable user yields `null`, which the callers treat as
 * fail-closed: no principal, so a user-scoped tool is denied rather than run
 * under ambient authority.
 */

import type { IAccountDirectoryService, IToolEndUserPrincipal } from '@/types';

/**
 * Converts a Better Auth user id into a live end-user principal, or `null` when
 * the id is empty, the accounts service is unavailable, or no such account
 * exists.
 */
export type EndUserResolver = (userId: string) => Promise<IToolEndUserPrincipal | null>;

/**
 * Build an {@link EndUserResolver} backed by the identity module's `'accounts'`
 * directory.
 *
 * The accounts service is read lazily through `getAccounts` on every call so the
 * resolver tolerates the boot-order race (the identity module registers
 * `'accounts'` during its own `run()`) and operator churn — the reference is
 * never cached.
 *
 * @param getAccounts - Late-binding accessor for the registered `'accounts'`
 *        service, or null/undefined when it is not present.
 * @returns A resolver mapping a Better Auth user id to its live principal.
 */
export function createAccountEndUserResolver(
    getAccounts: () => IAccountDirectoryService | null | undefined
): EndUserResolver {
    return async (userId: string): Promise<IToolEndUserPrincipal | null> => {
        let principal: IToolEndUserPrincipal | null = null;

        const id = typeof userId === 'string' ? userId.trim() : '';
        const accounts = id ? getAccounts() : null;
        const account = accounts ? await accounts.getAccount(id) : null;

        if (account) {
            principal = { userId: account.id, groups: account.groups };
            if (account.email) {
                principal.email = account.email;
            }
            if (account.primaryWallet) {
                principal.primaryWallet = account.primaryWallet;
            }
        }

        return principal;
    };
}
