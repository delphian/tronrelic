/**
 * @fileoverview Error types the consent services throw.
 *
 * The admin controller maps each class to one HTTP status, so a service never
 * has to know about HTTP and a controller never has to parse message text to
 * decide what went wrong.
 */

/**
 * A setting was malformed, such as a Google Ads id that is not `AW-` followed
 * by digits. Mapped to 400.
 */
export class ConsentValidationError extends Error {
    /**
     * @param message - Explanation shown to the administrator as-is.
     */
    constructor(message: string) {
        super(message);
        this.name = 'ConsentValidationError';
    }
}
