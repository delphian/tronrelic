/**
 * Shared constants for the menu module.
 *
 * Centralized here so the HTTP controller (read gate) and the service
 * (WebSocket broadcast suppression) reference the same source of truth
 * for which namespaces are admin-only. Splitting the list across two
 * files invited drift: a future operator could add a namespace to the
 * controller and forget the service (or vice versa), reintroducing
 * leakage in whichever side was missed.
 *
 * Currently empty. The `system` namespace was originally listed but had
 * to be removed because `/system/*` renders navigation via SSR
 * (`MenuNavSSR`), which has no admin token — gating reads of `system`
 * therefore broke admin nav for every authenticated admin. The actual
 * admin surface remains protected by `requireAdmin` on mutations and
 * `SystemAuthGate` on the page layout, and `/system/*` is `noindex`.
 *
 * Add namespaces here only if they can tolerate failing SSR fetches.
 */
export const ADMIN_NAMESPACES: ReadonlySet<string> = new Set();
