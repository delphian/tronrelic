/**
 * @fileoverview Browser-side TronLink message signing.
 *
 * Wallet linking proves control of a TRON address by having the user sign a
 * server-issued challenge with their own key. The only key holder in the
 * browser is the TronLink extension, which injects `window.tronWeb` /
 * `window.tronLink`. We talk to those injected objects directly and never
 * import the `tronweb` npm package on the client — that package is a Node.js
 * library whose browser bundle is huge and historically broken under Next.js;
 * the backend owns it for verification. This module is the single place the
 * profile wallet UI reaches the extension, so the connect-then-sign sequence
 * and its error mapping live in one tested spot.
 */

/**
 * Shape of TronLink's `tron_requestAccounts` response.
 *
 * The numeric `code` distinguishes the cases the UI must message differently:
 * 200 approved, 4000 a popup is already pending, 4001 the user rejected, and
 * a null/absent code when the wallet is locked.
 */
export interface ITronLinkRequestResponse {
    code: 200 | 4000 | 4001 | null;
    message?: string;
}

/**
 * The subset of the injected `tronWeb` object we depend on. Declared narrowly
 * so a future extension change surfaces as a type error rather than a silent
 * `undefined` call.
 */
interface ITronWebProvider {
    ready?: boolean;
    defaultAddress?: { base58?: string | false };
    request?: (args: { method: 'tron_requestAccounts' }) => Promise<ITronLinkRequestResponse>;
    trx?: { signMessageV2?: (message: string) => Promise<string> };
}

/**
 * The injected `tronLink` wrapper. Newer TronLink builds expose `request`
 * here and nest the `tronWeb` instance under it, so we read from both.
 */
interface ITronLinkProvider {
    ready?: boolean;
    tronWeb?: ITronWebProvider;
    request?: (args: { method: 'tron_requestAccounts' }) => Promise<ITronLinkRequestResponse>;
}

declare global {
    interface Window {
        tronWeb?: ITronWebProvider;
        tronLink?: ITronLinkProvider;
    }
}

/**
 * Read the page-level injected `tronWeb`, guarding against SSR where `window`
 * is undefined.
 *
 * @returns The injected provider, or undefined when absent or running on the server.
 */
function getTronWeb(): ITronWebProvider | undefined {
    return typeof window !== 'undefined' ? window.tronWeb : undefined;
}

/**
 * Read the injected `tronLink` wrapper, guarding against SSR.
 *
 * @returns The injected wrapper, or undefined when absent or running on the server.
 */
function getTronLink(): ITronLinkProvider | undefined {
    return typeof window !== 'undefined' ? window.tronLink : undefined;
}

/**
 * Resolve the currently selected base58 address from either injected object.
 * TronLink populates `defaultAddress.base58` only after the user approves a
 * connection, so an empty result is the signal that we still need to request
 * accounts.
 *
 * @returns The connected base58 address, or undefined if not yet connected.
 */
function readConnectedAddress(): string | undefined {
    const fromLink = getTronLink()?.tronWeb?.defaultAddress?.base58;
    const fromWeb = getTronWeb()?.defaultAddress?.base58;
    const address = fromLink || fromWeb;
    return typeof address === 'string' && address.length > 0 ? address : undefined;
}

/**
 * Ensure TronLink is connected and return the active base58 address.
 *
 * Linking needs the address *before* a challenge is requested (the backend
 * binds the challenge to a specific address), so connection is a discrete step
 * the caller can run first. It is a no-op approval when the user has already
 * authorised the site, so calling it again before signing costs nothing.
 *
 * @returns The connected base58 address.
 * @throws When TronLink is absent, locked, or the connection is rejected.
 */
export async function connectTronLink(): Promise<string> {
    if (typeof window === 'undefined') {
        throw new Error('Wallet signing is unavailable server-side.');
    }

    const tronLink = getTronLink();
    const tronWeb = getTronWeb();

    if (!tronLink && !tronWeb) {
        throw new Error('TronLink not detected. Install the TronLink extension and retry.');
    }

    // Request accounts only when no address is connected yet, so an
    // already-authorised user proceeds without an extra approval popup.
    if (!readConnectedAddress()) {
        const requestFn = tronLink?.request ?? tronWeb?.request;
        if (!requestFn) {
            throw new Error('TronLink connection request is unavailable. Update the extension and retry.');
        }

        const response = await requestFn({ method: 'tron_requestAccounts' });
        const code = response?.code ?? null;
        if (code === null) {
            throw new Error('TronLink is locked. Unlock your wallet and retry.');
        }
        if (code === 4000) {
            throw new Error('A TronLink connection request is already pending. Open the extension to continue.');
        }
        if (code === 4001) {
            throw new Error('Connection rejected in TronLink.');
        }
        if (code !== 200) {
            throw new Error(response?.message ?? 'TronLink connection failed.');
        }
    }

    const address = readConnectedAddress();
    if (!address) {
        throw new Error('Connected to TronLink but no address is selected. Pick an account and retry.');
    }

    return address;
}

/**
 * Connect to TronLink (if needed) and sign a server-issued challenge,
 * returning the signer's address alongside the signature so the caller can
 * submit both to the wallet-link endpoint.
 *
 * Why connect-then-sign: the backend binds the challenge to a specific
 * address, so we surface the exact address the extension will sign with
 * rather than trust caller-supplied input. The address is read from the
 * extension's `defaultAddress`, not recovered from the signature.
 *
 * @param message - The canonical challenge string from the wallet-challenge
 *   endpoint. It must be signed verbatim; the backend reconstructs and
 *   string-compares it before accepting the signature.
 * @returns The connected base58 address and the hex signature over `message`.
 * @throws When TronLink is absent, locked, rejected, or lacks signing capability —
 *   each mapped to a user-actionable message.
 */
export async function signMessageWithTronLink(
    message: string
): Promise<{ address: string; signature: string }> {
    const address = await connectTronLink();

    const signer = getTronWeb();
    if (!signer?.trx?.signMessageV2) {
        throw new Error('This TronLink build cannot sign messages (signMessageV2 missing).');
    }

    const signature = await signer.trx.signMessageV2(message);
    return { address, signature };
}
