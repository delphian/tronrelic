/**
 * @fileoverview Decides which apps may register with the OAuth server in
 * order to reach the MCP endpoint, and records the ones it refuses.
 *
 * An app identifies itself with the HTTPS address of a JSON document it
 * publishes. Without a rule, any address is accepted: the server fetches the
 * document and stores a client row for it, which a scanner used to register
 * an app of its own. This policy accepts only addresses on hosts the
 * deployment trusts.
 *
 * The identity module calls the policy, because it builds the OAuth server.
 * The policy lives here because the OAuth server exists only for MCP, and
 * because refusals must be written under the MCP module's log name to appear
 * on the Logs tab of `/system/mcp`.
 *
 * Facts about the refusal log:
 * - The refused address is text the caller chose, and the caller also decides
 *   how many requests to send.
 * - Each address is logged at most once per window, and only a fixed number
 *   of distinct addresses are logged per window.
 * - Only the host and path are logged, cut to a fixed length.
 */

import type { IMcpClientAdmissionPolicy, IMcpClientDetails, ISystemLogService } from '@/types';

/**
 * Hosts whose metadata documents the OAuth server accepts.
 *
 * `claude.ai` serves the documents for Claude and for Claude Code. To admit
 * another app, find the address it presented in the refusal entries on the
 * Logs tab of `/system/mcp`, confirm the host belongs to the app's vendor,
 * and add that host here.
 */
export const MCP_ALLOWED_CLIENT_HOSTS: readonly string[] = ['claude.ai'];

/** Length of one refusal-log window. Each address is logged once per window. */
export const REFUSAL_LOG_WINDOW_MS = 60 * 60 * 1000;

/**
 * How many distinct refused addresses are logged per window. A scanner can
 * send a different address on every request, so without this ceiling the log
 * would grow as fast as the scanner can send.
 */
export const REFUSAL_LOG_MAX_ADDRESSES = 50;

/** Longest address written to a log entry, in characters. */
export const REFUSAL_LOG_MAX_ADDRESS_LENGTH = 300;

/** Longest app name written to a log entry, in characters. */
const LOGGED_NAME_MAX_LENGTH = 100;

/** Most redirect addresses written to one log entry. */
const LOGGED_REDIRECTS_MAX = 10;

/** Key under which every address that does not parse shares one log entry per window. */
const UNREADABLE_ADDRESS_KEY = '(unreadable)';

/**
 * Parse an address without throwing, because the caller supplies the text and
 * a malformed one is an expected input rather than an error.
 *
 * @param raw - The address as the caller supplied it.
 * @returns The parsed URL, or null when the text is not a URL.
 */
function parseAddress(raw: string): URL | null {
    let parsed: URL | null = null;
    try {
        parsed = new URL(raw);
    } catch {
        parsed = null;
    }
    return parsed;
}

/** Cut text written by an outside party to a fixed length before it is logged. */
function cut(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) : text;
}

/**
 * Build the form of an address that is safe to log.
 *
 * Only the scheme, host, and path are kept. The query string, the fragment,
 * and any embedded user name or password are dropped, because they can carry
 * secrets or long payloads and are not needed to recognise an app. The URL
 * parser has already lowercased the host and percent-encoded spaces, control
 * characters, and non-ASCII characters, so the result is printable ASCII.
 *
 * @param url - The parsed address.
 * @returns The scheme, host, and path, uncut.
 */
function describeAddress(url: URL): string {
    return `${url.protocol}//${url.host}${url.pathname}`;
}

/** Report whether two lists hold the same addresses, ignoring order. */
function sameMembers(first: readonly string[], second: readonly string[]): boolean {
    const sortedFirst = [...first].sort();
    const sortedSecond = [...second].sort();
    return sortedFirst.length === sortedSecond.length && sortedFirst.every((value, index) => value === sortedSecond[index]);
}

/**
 * Admits apps by the host of their metadata document, and logs refusals.
 *
 * A utility rather than a shared service: startup builds one instance and
 * hands it to the identity module. It holds a small amount of state, the
 * addresses logged in the current window, and that state is per process. Two
 * backend instances each log a refused address once, which is acceptable for
 * a diagnostic log.
 */
export class McpClientAdmissionPolicy implements IMcpClientAdmissionPolicy {
    /** The allowed hosts, lowercased, for exact comparison with a parsed host. */
    private readonly allowedHosts: ReadonlySet<string>;

    /** When the current refusal-log window began, in milliseconds since the epoch. */
    private windowStartedAt = 0;

    /** The refused addresses already logged in the current window. */
    private readonly loggedThisWindow = new Set<string>();

    /** Whether the current window has already logged that its ceiling was reached. */
    private ceilingReported = false;

    /**
     * @param allowedHosts - Hosts whose metadata documents are accepted, such
     *   as `claude.ai`. Compared exactly, so a subdomain is not admitted by
     *   listing its parent.
     * @param logger - The MCP module's logger. Entries must be written under
     *   the MCP module's log name to appear on the Logs tab of `/system/mcp`.
     * @param now - Clock, in milliseconds. Tests supply their own to move
     *   between windows without waiting.
     */
    constructor(
        allowedHosts: readonly string[],
        private readonly logger: ISystemLogService,
        private readonly now: () => number = Date.now
    ) {
        this.allowedHosts = new Set(allowedHosts.map(host => host.trim().toLowerCase()).filter(host => host.length > 0));
    }

    /**
     * Decide whether an app that identifies itself with this address may
     * register, and log the address when it may not.
     *
     * An address is accepted only when it uses HTTPS on the default port,
     * carries no user name or password, and its host is on the list. The host
     * is compared after parsing, never by matching the raw text, so an
     * address such as `https://claude.ai.example.com/` or
     * `https://claude.ai@example.com/` is not mistaken for an allowed one.
     *
     * @param clientIdUrl - The address the app supplied as its client id.
     * @returns True when the app may register.
     */
    public isAllowed(clientIdUrl: string): boolean {
        const url = parseAddress(clientIdUrl);
        const allowed =
            url !== null &&
            url.protocol === 'https:' &&
            url.port === '' &&
            url.username === '' &&
            url.password === '' &&
            this.allowedHosts.has(url.hostname);
        if (!allowed) {
            this.recordRefusal(clientIdUrl, url);
        }
        return allowed;
    }

    /**
     * Compare a registered app's details before and after its metadata
     * document was re-read, and log a warning when its name or redirect
     * addresses changed.
     *
     * Only apps on an allowed host reach this point, so a change is the
     * vendor editing its own document. Approvals are deliberately left in
     * place: revoking them would disconnect every user of that app each time
     * the vendor made a routine change.
     *
     * @param previous - The app's details before the document was re-read.
     * @param current - The app's details afterwards.
     */
    public noteRefreshed(previous: IMcpClientDetails, current: IMcpClientDetails): void {
        const nameChanged = previous.name !== current.name;
        const redirectsChanged = !sameMembers(previous.redirectUris, current.redirectUris);
        if (nameChanged || redirectsChanged) {
            this.logger.warn(
                {
                    clientId: cut(current.clientId, REFUSAL_LOG_MAX_ADDRESS_LENGTH),
                    nameChanged,
                    redirectsChanged,
                    previousName: previous.name === null ? null : cut(previous.name, LOGGED_NAME_MAX_LENGTH),
                    name: current.name === null ? null : cut(current.name, LOGGED_NAME_MAX_LENGTH),
                    previousRedirectUris: this.loggableRedirects(previous.redirectUris),
                    redirectUris: this.loggableRedirects(current.redirectUris)
                },
                'Connected app changed its name or redirect addresses'
            );
        }
    }

    /** Bound a list of redirect addresses in both count and length before it is logged. */
    private loggableRedirects(redirectUris: readonly string[]): string[] {
        return redirectUris.slice(0, LOGGED_REDIRECTS_MAX).map(uri => cut(uri, REFUSAL_LOG_MAX_ADDRESS_LENGTH));
    }

    /**
     * Log one refused address, within the limits that keep a scanner from
     * filling the log.
     *
     * An address already logged in the current window is skipped. Once the
     * window has logged `REFUSAL_LOG_MAX_ADDRESSES` distinct addresses, one
     * further entry says the ceiling was reached and the rest are dropped
     * until the next window.
     *
     * @param raw - The address as the caller supplied it; only its length is
     *   logged when it does not parse.
     * @param url - The parsed address, or null when it did not parse.
     */
    private recordRefusal(raw: string, url: URL | null): void {
        const nowMs = this.now();
        if (nowMs - this.windowStartedAt >= REFUSAL_LOG_WINDOW_MS) {
            this.windowStartedAt = nowMs;
            this.loggedThisWindow.clear();
            this.ceilingReported = false;
        }

        // The cut address is also the key, so a very long address cannot make
        // the set of remembered addresses large.
        const fullAddress = url === null ? null : describeAddress(url);
        const address = fullAddress === null ? null : cut(fullAddress, REFUSAL_LOG_MAX_ADDRESS_LENGTH);
        const key = address ?? UNREADABLE_ADDRESS_KEY;
        if (!this.loggedThisWindow.has(key)) {
            if (this.loggedThisWindow.size >= REFUSAL_LOG_MAX_ADDRESSES) {
                if (!this.ceilingReported) {
                    this.ceilingReported = true;
                    this.logger.warn(
                        { loggedAddresses: this.loggedThisWindow.size, windowMinutes: REFUSAL_LOG_WINDOW_MS / 60_000 },
                        'OAuth app refusals are no longer being logged this window: the limit on distinct addresses was reached'
                    );
                }
            } else {
                this.loggedThisWindow.add(key);
                if (url === null || address === null || fullAddress === null) {
                    this.logger.warn(
                        { suppliedLength: raw.length },
                        'OAuth app refused: the address it supplied could not be read'
                    );
                } else {
                    // Both fields are text the caller chose. They are bounded
                    // here; whatever displays them is responsible for escaping.
                    this.logger.warn(
                        {
                            callerSuppliedHost: cut(url.hostname, REFUSAL_LOG_MAX_ADDRESS_LENGTH),
                            callerSuppliedAddress: address,
                            addressTruncated: fullAddress.length > REFUSAL_LOG_MAX_ADDRESS_LENGTH
                        },
                        'OAuth app refused: its address is not on the allowed list'
                    );
                }
            }
        }
    }
}
