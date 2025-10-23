import type { IHttpRequest } from '@tronrelic/types';

/**
 * Validates Telegram webhook requests using IP allowlist and secret token.
 * This module preserves the sophisticated IP validation logic from the deleted config/telegram.ts.
 *
 * Security layers:
 * 1. IP allowlist - Only Telegram's official server IPs can send webhooks
 * 2. Webhook secret - Custom token shared between bot and TronRelic
 *
 * Why both layers matter:
 * - IP allowlist prevents spoofed requests from unauthorized servers
 * - Webhook secret prevents replay attacks even from allowed IPs
 */

/**
 * Default Telegram server IP ranges in CIDR notation.
 * These are Telegram's official webhook source IPs as of 2024.
 * Source: https://core.telegram.org/bots/webhooks#the-short-version
 */
const DEFAULT_TELEGRAM_IPS = '149.154.160.0/20,91.108.4.0/22';

/**
 * Validates that the incoming request originates from Telegram's official servers.
 * Uses ipaddr.js library for sophisticated CIDR range matching.
 *
 * @param req - HTTP request object with headers and connection info
 * @param allowedCidrs - Comma-separated CIDR ranges (defaults to Telegram's official IPs)
 * @returns True if request IP matches allowlist, false otherwise
 *
 * Why this validation exists:
 * Webhook endpoints are publicly accessible URLs. Without IP filtering, any attacker could send
 * fake Telegram updates to the bot. This validation ensures only Telegram's servers can trigger
 * webhook processing.
 */
export async function validateTelegramIp(req: IHttpRequest, allowedCidrs?: string): Promise<boolean> {
    // Dynamically import ipaddr.js to avoid bundling it in frontend
    const ipaddr = await import('ipaddr.js');

    const cidrs = (allowedCidrs || DEFAULT_TELEGRAM_IPS).split(',').map(s => s.trim());

    // Extract client IP from request (supports proxy headers)
    // Cloudflare sets CF-Connecting-IP to the original client IP
    // Fallback to x-forwarded-for (takes first IP) if not behind Cloudflare
    const clientIp = (req.headers['cf-connecting-ip'] as string)
        || (req.headers['x-forwarded-for']
            ? (req.headers['x-forwarded-for'] as string).split(',')[0].trim()
            : req.ip || '');

    if (!clientIp) {
        return false;
    }

    try {
        const addr = ipaddr.default.process(clientIp);

        // Check if IP matches any allowed CIDR range
        for (const cidr of cidrs) {
            const [range, bits] = cidr.split('/');
            const rangeAddr = ipaddr.default.process(range);
            const prefixLength = parseInt(bits, 10);

            // Check if both addresses are the same kind (IPv4 or IPv6)
            if (addr.kind() !== rangeAddr.kind()) {
                continue;
            }

            // Use type assertion since we know they're the same kind
            // This works around TypeScript's strict union type checking for match()
            const matches = (addr as any).match(rangeAddr, prefixLength);
            if (matches) {
                return true;
            }
        }

        // No CIDR range matched - validation failed
        return false;
    } catch (error) {
        // IP parsing failed - validation failed
        return false;
    }
}

/**
 * Validates the Telegram webhook secret token.
 * Telegram sends this in the x-telegram-bot-api-secret-token header.
 *
 * @param req - HTTP request with headers
 * @param expectedSecret - Secret token configured in environment (optional)
 * @returns True if secret matches or no secret is configured, false if mismatch
 *
 * Why this validation exists:
 * Even if an attacker spoofs a Telegram IP, they cannot know the webhook secret token.
 * This provides defense-in-depth against sophisticated attacks.
 *
 * If no secret is configured, validation passes (backward compatibility).
 */
export function validateWebhookSecret(req: IHttpRequest, expectedSecret?: string): boolean {
    // If no secret is configured, skip validation
    if (!expectedSecret) {
        return true;
    }

    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    return receivedSecret === expectedSecret;
}

/**
 * Combined security validation for Telegram webhooks.
 * Checks both IP allowlist and webhook secret.
 *
 * @param req - HTTP request object
 * @param options - Security configuration
 * @returns True if request passes all security checks, false otherwise
 *
 * Why combined validation:
 * Defense-in-depth security principle. Multiple independent validation layers
 * reduce the risk of successful attacks even if one layer is compromised.
 */
export async function validateTelegramWebhook(
    req: IHttpRequest,
    options: {
        allowedIps?: string;
        webhookSecret?: string;
    } = {}
): Promise<boolean> {
    // Validate IP allowlist
    const ipValid = await validateTelegramIp(req, options.allowedIps);
    if (!ipValid) {
        return false;
    }

    // Validate webhook secret
    const secretValid = validateWebhookSecret(req, options.webhookSecret);
    if (!secretValid) {
        return false;
    }

    return true;
}
