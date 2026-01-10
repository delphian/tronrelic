import type { IHttpRequest } from '@/types';
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
export declare function validateTelegramIp(req: IHttpRequest, allowedCidrs?: string): Promise<boolean>;
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
export declare function validateWebhookSecret(req: IHttpRequest, expectedSecret?: string): boolean;
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
export declare function validateTelegramWebhook(req: IHttpRequest, options?: {
    allowedIps?: string;
    webhookSecret?: string;
}): Promise<boolean>;
//# sourceMappingURL=security.d.ts.map