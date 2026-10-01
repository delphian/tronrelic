/**
 * @fileoverview Removes secrets from MCP tool results before they leave the
 * platform.
 *
 * A user group can be allowed restricted tools, such as the log readers, whose
 * results may carry credentials. The caller's own AI client can send anything
 * it receives off-site, so a group can also ask for its results to be
 * scrubbed. Three passes do the work:
 *
 * 1. Exact values. The deployment's own secrets (admin token, auth secrets,
 *    API keys, database URLs) are known to the backend, so any occurrence of
 *    one is replaced. This is the pass that is both precise and complete for
 *    the secrets that matter most.
 * 2. Patterns. Common credential shapes the backend does not hold a copy of:
 *    private key blocks, JSON Web Tokens, passwords inside connection URLs,
 *    bearer tokens, and well-known API key prefixes.
 * 3. Field names. In a structured result, a string stored under a key such as
 *    `password` or `apiKey` is replaced whatever it contains.
 *
 * It is a belt-and-braces measure, not a guarantee. A secret this code has
 * never seen and that matches no pattern passes through, and a TRON private
 * key looks exactly like a transaction hash, so it cannot be told apart.
 */

/** What replaces each removed secret, so a reader can see that something was taken out. */
export const REDACTION_MARKER = '[REDACTED]';

/**
 * Shortest known secret value that is matched exactly. Shorter values, such as
 * an empty or placeholder password in local development, would match ordinary
 * words and blank out unrelated text.
 */
const MIN_KNOWN_SECRET_LENGTH = 12;

/** How deep a result is walked. Deeper values are replaced rather than passed through unchecked. */
const MAX_DEPTH = 32;

/**
 * Credential shapes matched in any string. Each pattern's first capture
 * group, when it has one, is kept, so a connection URL keeps its scheme and a
 * header keeps its `Bearer` label.
 */
const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; keepPrefix: boolean }> = [
    // PEM private key blocks, whole.
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, keepPrefix: false },
    // JSON Web Tokens: three base64url segments, the first two starting with `eyJ`.
    { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, keepPrefix: false },
    // The user:password part of a URL such as mongodb://user:pass@host. The
    // user name may be empty, as in the usual Redis form redis://:pass@host.
    { pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:@/]*:[^\s@/]+(?=@)/gi, keepPrefix: true },
    // Bearer and Basic credentials in a header value.
    { pattern: /(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/-]{16,}=*/g, keepPrefix: true },
    // Provider API keys with recognisable prefixes: Anthropic/OpenAI, GitHub, Slack, AWS, Resend.
    { pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g, keepPrefix: false },
    { pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, keepPrefix: false },
    { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, keepPrefix: false },
    { pattern: /\bAKIA[0-9A-Z]{16}\b/g, keepPrefix: false },
    { pattern: /\bre_[A-Za-z0-9_]{20,}/g, keepPrefix: false },
    // Telegram bot tokens (`<bot id>:<35-character secret>`). The Telegram bot
    // plugin stores one, and it also appears inside api.telegram.org/bot<token>/
    // URLs, where a word boundary would not match between "bot" and the id.
    { pattern: /(?<!\d)\d{6,12}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, keepPrefix: false }
];

/**
 * Field names whose string value is replaced whatever it contains. Exact
 * names only: a looser match such as anything containing "token" would blank
 * out TRON token addresses, which are ordinary public data here.
 */
const SECRET_FIELD_NAME_ALTERNATION = 'password|passwd|secret|client_?secret|api_?key|apikey|access_?token|refresh_?token|auth_?token|id_?token|bot_?token|authorization|cookie|set-cookie|private_?key|secret_?key|session_?secret|webhook_?secret';

/** Matches a whole object key against {@link SECRET_FIELD_NAME_ALTERNATION}. */
const SECRET_FIELD_NAMES = new RegExp(`^(?:${SECRET_FIELD_NAME_ALTERNATION})$`, 'i');

/**
 * Matches the same field names inside text that already holds serialized
 * JSON, such as a log entry's context that the log tools stringify and
 * truncate before returning it. The object walk never sees those keys, so
 * without this pass a `"password":"…"` pair inside a string would pass
 * through. The value runs to the next unescaped quote, or to the end of the
 * text when truncation cut it off, and the key and opening quote are kept.
 */
const SECRET_JSON_FIELD_PATTERN = new RegExp(`("(?:${SECRET_FIELD_NAME_ALTERNATION})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)*`, 'gi');

/**
 * Escape a literal string for use inside a regular expression.
 *
 * @param value - The literal to match.
 * @returns The value with every regex metacharacter escaped.
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scrubs secrets out of tool results. Built once at module start with the
 * deployment's secret values, then shared by every request.
 */
export class SecretScrubber {
    /** One alternation over every known secret, longest first so a secret containing another is matched whole. */
    private readonly knownSecretsPattern: RegExp | null;

    /**
     * @param knownSecrets - The deployment's own secret values, such as
     *   `ADMIN_API_TOKEN` and database URLs. Blank and very short values are
     *   ignored, because they would match ordinary text.
     */
    constructor(knownSecrets: readonly string[]) {
        const usable = [...new Set(knownSecrets.filter(value => typeof value === 'string' && value.length >= MIN_KNOWN_SECRET_LENGTH))]
            .sort((a, b) => b.length - a.length);
        this.knownSecretsPattern = usable.length > 0 ? new RegExp(usable.map(escapeRegExp).join('|'), 'g') : null;
    }

    /**
     * Return a copy of a tool result with secrets replaced.
     *
     * Strings are scrubbed wherever they appear, including inside arrays and
     * nested objects. Object keys are left alone, because they are field
     * names chosen by the tool, not data. The input is never modified.
     *
     * @param value - The tool result, as JSON-compatible data.
     * @returns The scrubbed copy.
     */
    scrub<T>(value: T): T {
        return this.walk(value, 0) as T;
    }

    /**
     * Scrub one string through the known-value and pattern passes.
     *
     * @param text - Any string from a tool result.
     * @returns The string with each match replaced by the marker.
     */
    scrubText(text: string): string {
        let scrubbed = this.knownSecretsPattern ? text.replace(this.knownSecretsPattern, REDACTION_MARKER) : text;
        for (const { pattern, keepPrefix } of SECRET_PATTERNS) {
            scrubbed = scrubbed.replace(pattern, (_match: string, prefix?: unknown) =>
                keepPrefix && typeof prefix === 'string' ? `${prefix}${REDACTION_MARKER}` : REDACTION_MARKER);
        }
        scrubbed = scrubbed.replace(SECRET_JSON_FIELD_PATTERN, `$1${REDACTION_MARKER}`);
        return scrubbed;
    }

    /**
     * Walk a value and scrub every string in it.
     *
     * A value with its own `toJSON`, such as a `Date`, a Mongo `ObjectId`, a
     * `Decimal128`, or a `Buffer`, is walked in its JSON form. Copying its own
     * fields instead would turn an `ObjectId` into `{ buffer: … }` and change
     * what the client receives once the result is serialised.
     *
     * @param value - The value at this point in the result.
     * @param depth - How deep the walk is, to stop on a pathologically nested result.
     * @returns The scrubbed copy of the value.
     */
    private walk(value: unknown, depth: number): unknown {
        let result: unknown;
        if (typeof value === 'string') {
            result = this.scrubText(value);
        } else if (value === null || typeof value !== 'object') {
            result = value;
        } else if (depth >= MAX_DEPTH) {
            result = REDACTION_MARKER;
        } else if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
            result = this.walk((value as { toJSON: () => unknown }).toJSON(), depth + 1);
        } else if (Array.isArray(value)) {
            result = value.map(item => this.walk(item, depth + 1));
        } else {
            // Object.fromEntries defines each key as an own property, so a key
            // such as `__proto__` from parsed JSON is copied rather than
            // setting the copy's prototype and vanishing from the output.
            result = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, field]) => [
                key,
                typeof field === 'string' && SECRET_FIELD_NAMES.test(key)
                    ? REDACTION_MARKER
                    : this.walk(field, depth + 1)
            ]));
        }
        return result;
    }
}
