/**
 * User module library utilities barrel export.
 */

// Identity utilities (client-side)
export {
    USER_ID_COOKIE_NAME,
    USER_ID_STORAGE_KEY,
    COOKIE_MAX_AGE,
    generateUUID,
    isValidUUID,
    getUserIdFromCookie,
    getUserIdFromStorage,
    setUserIdCookie,
    getOrCreateUserId,
    clearUserIdentity
} from './identity';

// TronLink wallet provider utilities (client-side)
export {
    getTronWeb,
    assertTronWeb
} from './tronWeb';

export type { TronWebProvider } from './tronWeb';

// NOTE: Server-side utilities (getServerUserId, getServerUser, hasServerUserIdentity)
// must be imported directly from './server' in Server Components only.
// They use next/headers which cannot be bundled into client components.
