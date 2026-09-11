/**
 * @fileoverview Reading and saving the header's sign-in button image.
 *
 * The image lives on the system config document beside the site URL and the
 * emit-buffer settings, so this module talks to the same endpoint as
 * `SystemConfigSection` and `emit-buffer-api`. It sends only its own two
 * fields, so saving the image can never overwrite another card's values.
 *
 * @module app/(core)/system/system/components/auth-button-image-api
 */

/** Where the system configuration document is read and written. */
const SYSTEM_CONFIG_ENDPOINT = '/api/admin/system/config/system';

/** The sign-in button image slice of the system configuration document. */
export interface IAuthButtonImageView {
    /** URL the files provider returned for the image, or null for the default button. */
    authButtonImageUrl: string | null;
    /** Files-provider id of the same image, or null when none is recorded. */
    authButtonImageFileId: string | null;
}

/**
 * Read one optional string field off the config response.
 *
 * Older documents do not carry these fields at all, and an empty string means
 * nothing is set, so both are folded into null here. The card then has one
 * value to test for "no image" rather than three.
 *
 * @param value - The raw field from the response, of unknown type.
 * @returns The string when it has content, otherwise null.
 */
function readOptionalString(value: unknown): string | null {
    const result = typeof value === 'string' && value !== '' ? value : null;

    return result;
}

/**
 * Pull the image fields out of a system config response.
 *
 * The endpoint answers with the whole configuration document. Narrowing it
 * here keeps the component's state to the two fields it owns, so nothing else
 * on the document can end up in this card's save payload.
 *
 * @param config - The `config` object from the endpoint, of unknown shape.
 * @returns Just the image URL and its file id.
 */
function toView(config: Record<string, unknown>): IAuthButtonImageView {
    const view: IAuthButtonImageView = {
        authButtonImageUrl: readOptionalString(config.authButtonImageUrl),
        authButtonImageFileId: readOptionalString(config.authButtonImageFileId)
    };

    return view;
}

/**
 * Fetch the stored sign-in button image.
 *
 * The admin session cookie authorizes the request, and the gate around the
 * System page has already established that the visitor is an administrator.
 *
 * @returns The stored image URL and file id, both null when no image is set.
 * @throws When the request fails, so the card can say so rather than showing
 *         "no image set" for a setting it could not read.
 */
export async function getAuthButtonImage(): Promise<IAuthButtonImageView> {
    const response = await fetch(SYSTEM_CONFIG_ENDPOINT);

    if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
    }

    const data = await response.json();

    return toView(data.config ?? {});
}

/**
 * Save the sign-in button image, or clear it by sending null.
 *
 * Both fields are always sent together, because the backend treats them as one
 * setting and refuses a file id sent without its URL.
 *
 * @param view - The image as the card currently holds it.
 * @returns The stored values as the backend echoed them back.
 * @throws With the backend's own message when the URL is rejected, so the card
 *         can show which rule was broken.
 */
export async function updateAuthButtonImage(view: IAuthButtonImageView): Promise<IAuthButtonImageView> {
    const response = await fetch(SYSTEM_CONFIG_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(view)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data?.error || `Request failed: ${response.statusText}`);
    }

    return toView(data.config ?? {});
}
