/**
 * @file ICurationCommitContext.ts
 *
 * Who caused a write that curation hands to a type's `applyEdit`. The patch
 * alone says what changes, not who changed it, so a type whose approval
 * rewrites configuration had no way to attribute the write or to refuse one
 * made without a signed-in person. Curation passes this as the third argument
 * on every decision commit and every inline edit.
 */

/**
 * The actor behind one `applyEdit` call.
 */
export interface ICurationCommitContext {
    /**
     * Better Auth user id of the curator who decided or edited the item, or a
     * `system:` id such as `system:policy-auto-approve` when no person did.
     * Absent when the request authenticated with the `ADMIN_API_TOKEN`
     * service token, which carries no user identity.
     */
    actorId?: string;
}
