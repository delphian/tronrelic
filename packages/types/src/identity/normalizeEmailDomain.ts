/**
 * @fileoverview Turns an admin-typed domain, or the domain of an email
 * address, into the one form domain rules are stored and matched in.
 *
 * Shared so the admin form rejects exactly what the backend would reject.
 */

/**
 * A domain of two or more labels, each of letters, digits, and hyphens.
 * Internationalised domains are matched in their `xn--` form, which is what
 * a mail server sees.
 */
const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Normalize a domain or an email address to a lowercase domain.
 *
 * Accepts `Example.COM`, `@example.com`, `example.com.`, or a whole address
 * such as `someone@example.com`, and returns `example.com` for each. The part
 * after the last `@` is taken, so an address with a quoted `@` in its local
 * part still yields its real domain.
 *
 * @param value - What an admin typed, or an address from a sign-up request.
 * @returns The lowercase domain, or null when the value is not a valid domain.
 */
export function normalizeEmailDomain(value: unknown): string | null {
    let domain: string | null = null;
    if (typeof value === 'string') {
        const afterAt = value.slice(value.lastIndexOf('@') + 1);
        const candidate = afterAt.trim().toLowerCase().replace(/\.$/, '');
        domain = DOMAIN_PATTERN.test(candidate) ? candidate : null;
    }
    return domain;
}
