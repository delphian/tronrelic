/**
 * @file IContentActor.ts
 *
 * Who is performing a managed content operation. Every create, update, delete,
 * and restore that passes through the core content service carries one, for
 * two reasons: the core content row records who made each change, and whether
 * the actor is a curator decides if a change to a reviewed field is approved on
 * the spot or held for review.
 */

/**
 * The performer of one content operation.
 *
 * The caller builds the actor from what it has already authenticated — a route
 * handler from the request's admin session, a scheduled job from its own name.
 * Core trusts the caller's `isCurator` claim; modules and plugins are expected
 * to act in good faith, and the content system does not defend against one that
 * lies about who is acting.
 */
export interface IContentActor {
    /**
     * Stable id recorded on the content row. A Better Auth user id for a
     * person, or a `system:<name>` stand-in (for example
     * `system:service-token`) when no person is behind the call.
     */
    id: string;

    /** Whether a person or an automated caller is acting. */
    kind: 'user' | 'system';

    /**
     * Whether this actor may approve content. A curator's change to a reviewed
     * field is approved immediately with the curator recorded as the decider;
     * anyone else's change is held in the curation queue. Only a signed-in admin
     * is a curator today — a shared service token never is.
     */
    isCurator: boolean;
}
