/**
 * @fileoverview Client-side API helpers for the self-service wallet endpoints.
 *
 * Every call is a same-origin fetch, so the browser attaches the Better Auth
 * session cookie automatically and the backend gates each route on the logged-in
 * user. Centralising the five `/api/user/wallets/*` calls here keeps the request
 * shapes in one place and gives the UI a single, typed surface to mutate wallet
 * state — components never hand-roll fetches or re-derive the contract.
 */

import type {
    ILinkedWallet,
    IWalletChallenge,
    WalletAction
} from '@/types';

/** Body fields the link/unlink/set-primary endpoints expect after signing. */
interface ISignedProof {
    /** Canonical challenge message, signed verbatim by the wallet. */
    message: string;

    /** TronLink signature over `message`. */
    signature: string;

    /** Single-use nonce minted by the challenge endpoint. */
    nonce: string;
}

/**
 * Parse a wallet endpoint response, surfacing the backend's `message`/`error`
 * fields as a thrown Error so callers can toast a meaningful reason instead of
 * a generic failure.
 *
 * @param response - The raw fetch response from a wallet endpoint.
 * @returns The parsed JSON body typed as `T`.
 * @throws When the response status is not ok, using the backend error message.
 */
async function parse<T>(response: Response): Promise<T> {
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
        const reason = body?.message || body?.error || `Request failed (${response.status})`;
        throw new Error(reason);
    }
    return body as T;
}

/**
 * List the signed-in account's linked wallets, oldest first.
 *
 * @returns The account's linked wallets.
 */
export async function listWallets(): Promise<ILinkedWallet[]> {
    const body = await parse<{ wallets: ILinkedWallet[] }>(
        await fetch('/api/user/wallets', { cache: 'no-store' })
    );
    return body.wallets;
}

/**
 * Mint a single-use challenge for a wallet action. The returned `message` must
 * be signed verbatim and submitted back with its `nonce`.
 *
 * @param action - The action the challenge authorises (`link`/`unlink`/`set-primary`).
 * @param address - The wallet address the action targets (hex or base58).
 * @returns The challenge nonce, message, and expiry.
 */
export async function issueWalletChallenge(
    action: WalletAction,
    address: string
): Promise<IWalletChallenge> {
    const body = await parse<IWalletChallenge>(
        await fetch('/api/user/wallets/challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, address })
        })
    );
    return body;
}

/**
 * Link a freshly signed wallet to the account.
 *
 * @param address - The signer's address as reported by the wallet extension.
 * @param proof - The signed challenge message, signature, and nonce.
 * @returns The full updated wallet list.
 */
export async function linkWallet(
    address: string,
    proof: ISignedProof
): Promise<ILinkedWallet[]> {
    const body = await parse<{ wallets: ILinkedWallet[] }>(
        await fetch('/api/user/wallets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, ...proof })
        })
    );
    return body.wallets;
}

/**
 * Unlink a wallet. The address rides in the path; the body carries the signed
 * proof for the `unlink` action.
 *
 * @param address - The base58 wallet address to detach.
 * @param proof - The signed challenge message, signature, and nonce.
 * @returns The full updated wallet list after removal.
 */
export async function unlinkWallet(
    address: string,
    proof: ISignedProof
): Promise<ILinkedWallet[]> {
    const body = await parse<{ wallets: ILinkedWallet[] }>(
        await fetch(`/api/user/wallets/${encodeURIComponent(address)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proof)
        })
    );
    return body.wallets;
}

/**
 * Promote a wallet to primary. Requires step-up signature proof so a stolen
 * session cookie alone cannot move the primary.
 *
 * @param address - The base58 wallet address to promote.
 * @param proof - The signed challenge message, signature, and nonce.
 * @returns The full updated wallet list after promotion.
 */
export async function setPrimaryWallet(
    address: string,
    proof: ISignedProof
): Promise<ILinkedWallet[]> {
    const body = await parse<{ wallets: ILinkedWallet[] }>(
        await fetch(`/api/user/wallets/${encodeURIComponent(address)}/primary`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proof)
        })
    );
    return body.wallets;
}
