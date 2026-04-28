/**
 * User module library utilities barrel export.
 */

// Identity constants and validators. The server owns cookie writes; this
// module is intentionally minimal now that JS UUID generation,
// setUserIdCookie, and the localStorage mirror have been removed.
export {
    USER_ID_COOKIE_NAME,
    isValidUUID
} from './identity';

// TronLink wallet provider utilities (client-side)
export {
    getTronWeb,
    getTronLink,
    assertTronWeb
} from './tronWeb';

export type { TronWebProvider, TronLinkProvider, TronLinkRequestResponse } from './tronWeb';

// SSR state building utilities (safe for client components)
export { buildSSRUserState } from './ssr-state';
export type { SSRUserData } from './ssr-state';

// NOTE: Server-side utilities (getServerUserId, getServerUser, hasServerUserIdentity)
// must be imported directly from './server' in Server Components only.
// They use next/headers which cannot be bundled into client components.
