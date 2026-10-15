/**
 * @fileoverview Error types the localization services throw.
 *
 * The admin controller maps each class to one HTTP status, so a service never
 * has to know about HTTP and a controller never has to parse message text to
 * decide what went wrong.
 */

/**
 * The request was malformed or named a value the module does not accept, such
 * as an invalid language code or route pattern. Mapped to 400.
 */
export class LocalizationValidationError extends Error {
    /**
     * @param message - Explanation shown to the administrator as-is.
     */
    constructor(message: string) {
        super(message);
        this.name = 'LocalizationValidationError';
    }
}

/**
 * The language, route, key, or translation named in the request does not
 * exist. Mapped to 404.
 */
export class LocalizationNotFoundError extends Error {
    /**
     * @param message - Explanation shown to the administrator as-is.
     */
    constructor(message: string) {
        super(message);
        this.name = 'LocalizationNotFoundError';
    }
}

/**
 * The change would collide with something that already exists: a duplicate
 * language or pattern, or a language code that existing pages already use as
 * their first path segment. Mapped to 409.
 */
export class LocalizationConflictError extends Error {
    /**
     * @param message - Explanation shown to the administrator as-is.
     */
    constructor(message: string) {
        super(message);
        this.name = 'LocalizationConflictError';
    }
}
