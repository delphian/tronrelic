/**
 * @fileoverview Admin HTTP handlers for external-provider configuration.
 *
 * Why these guards matter: a vendor's API key is a secret. GET returns only the
 * masked view, and the save handler refuses to persist a re-echoed mask (so a
 * round-trip of the masked value can never overwrite the real key with `****…`),
 * while honouring an explicit clear sentinel. The test handler exercises a live
 * vendor call so an operator can confirm a pasted key works before relying on it
 * for ingestion.
 *
 * The generic handlers work from a vendor's descriptor: each field's kind
 * carries its own validation rule, so a vendor declared in the registry gets a
 * list entry, a read, a guarded save, and a test with no handler written for
 * it. TronGrid keeps bespoke handlers because its rotating key pool is not a
 * single secret field.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { ProviderConfigService, ProviderConfigValidationError } from '../services/provider-config.service.js';
import type { IProviderRegistry, IProviderVendor } from '../services/provider-registry.service.js';
import { TronGridProviderClient } from '../clients/tron-grid.client.js';
import {
    CLEAR_SENTINEL,
    TRONGRID_LIMITS,
    type IProviderFieldDescriptor,
    type ITronGridProviderConfig
} from '../database/index.js';

/**
 * Coerce a request-body value into an integer inside an inclusive range.
 *
 * Why reject rather than clamp: these are pacing controls an operator types by
 * hand, and silently rewriting 20000 to 10000 would leave the form showing a
 * number the backend never agreed to. Out-of-range input comes back as an error
 * the field can display.
 *
 * The type gate matters as much as the bounds. A bare `Number(value)` turns
 * `null`, `true`, `''`, and `[]` into finite integers, so `requestThrottleMs:
 * null` would pass the `{min: 0}` bound and silently persist "no pacing at all"
 * behind a 200 response. Only a real number — or a non-empty numeric string, so
 * a hand-written `curl` call still works — is accepted.
 *
 * @param value - Raw value from the JSON body.
 * @param bounds - Inclusive min/max the field accepts.
 * @returns The integer, or undefined when the value is absent or unusable.
 */
function readBoundedInteger(value: unknown, bounds: { min: number; max: number }): number | undefined {
    let numeric: number;
    if (typeof value === 'number') {
        numeric = value;
    } else if (typeof value === 'string' && value.trim()) {
        numeric = Number(value);
    } else {
        return undefined;
    }
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
        return undefined;
    }
    if (numeric < bounds.min || numeric > bounds.max) {
        return undefined;
    }
    return numeric;
}

/**
 * Validate an operator-supplied base URL and strip its trailing slashes so a
 * client's `${baseUrl}${path}` join cannot produce a double slash.
 *
 * The shape check is a security control, not a typo guard. Whatever is stored
 * here becomes the host these clients hand their stored credentials to — the
 * TronGrid probe puts every key in the pool into a `TRON-PRO-API-KEY` header —
 * so accepting an arbitrary string turns a config write into a key-exfiltration
 * primitive and the test button into a blind network probe. Demanding an
 * absolute `http:`/`https:` URL with a host closes the scheme half of that
 * (`javascript:`, `file:`, bare hostnames). It deliberately does *not* restrict
 * which host: pointing the client at a private full node is a supported
 * deployment, so what still guards the destination is the admin gate on the
 * route, not this function.
 *
 * The trailing-slash trim is a linear scan rather than a `/\/+$/` regex, which
 * CodeQL flags as a polynomial-ReDoS risk on user-provided input.
 *
 * @param raw - The URL as typed.
 * @returns The normalized URL, or null when it is not a usable absolute HTTP(S) URL.
 */
function normalizeBaseUrl(raw: string): string | null {
    const trimmed = raw.trim();
    let sliceEnd = trimmed.length;
    while (sliceEnd > 0 && trimmed[sliceEnd - 1] === '/') {
        sliceEnd -= 1;
    }
    const candidate = trimmed.slice(0, sliceEnd);
    if (!candidate) {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return null;
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
        return null;
    }
    return candidate;
}

/** Rejection message for a base URL that is not an absolute HTTP(S) URL. */
const INVALID_BASE_URL_MESSAGE = 'baseUrl must be an absolute http:// or https:// URL, for example https://api.trongrid.io';

/**
 * Outcome of validating one field of a generic save: either a value to write,
 * an instruction to leave the field alone, or a reason the value was refused.
 */
type FieldValidation =
    | { status: 'set'; value: unknown }
    | { status: 'skip' }
    | { status: 'reject'; reason: string };

/**
 * Validate one body value against its field descriptor. Absent is "leave it";
 * present-but-unusable is an operator error worth reporting, never silently
 * dropped, because a 200 that ignored a field would leave the form showing a
 * value the backend never agreed to.
 *
 * A secret has one extra rule: a value beginning `****` is the masked echo the
 * form loaded, so it is ignored rather than written back over the real key, and
 * the clear sentinel empties the key.
 *
 * @param field - The field's descriptor.
 * @param value - The raw body value.
 * @returns What to do with the field.
 */
function validateField(field: IProviderFieldDescriptor, value: unknown): FieldValidation {
    if (value === undefined) {
        return { status: 'skip' };
    }
    let result: FieldValidation;
    switch (field.kind) {
        case 'boolean':
            result = typeof value === 'boolean'
                ? { status: 'set', value }
                : { status: 'reject', reason: `${field.key} must be true or false` };
            break;
        case 'integer': {
            const bounds = { min: field.min ?? Number.MIN_SAFE_INTEGER, max: field.max ?? Number.MAX_SAFE_INTEGER };
            const numeric = readBoundedInteger(value, bounds);
            result = numeric === undefined
                ? { status: 'reject', reason: `${field.key} must be a whole number between ${bounds.min} and ${bounds.max}` }
                : { status: 'set', value: numeric };
            break;
        }
        case 'select': {
            const allowed = (field.options ?? []).map((option) => option.value);
            result = typeof value === 'string' && allowed.includes(value)
                ? { status: 'set', value }
                : { status: 'reject', reason: `${field.key} must be one of: ${allowed.join(', ')}` };
            break;
        }
        case 'url': {
            if (typeof value !== 'string') {
                result = { status: 'reject', reason: `${field.key} must be a string` };
                break;
            }
            // An empty string is the form's "leave it" for a URL, not a clear.
            if (!value.trim()) {
                result = { status: 'skip' };
                break;
            }
            const normalized = normalizeBaseUrl(value);
            result = normalized
                ? { status: 'set', value: normalized }
                : { status: 'reject', reason: INVALID_BASE_URL_MESSAGE.replace('baseUrl', field.key) };
            break;
        }
        case 'secret': {
            if (typeof value !== 'string') {
                result = { status: 'reject', reason: `${field.key} must be a string` };
                break;
            }
            const trimmed = value.trim();
            if (trimmed === CLEAR_SENTINEL) {
                result = { status: 'set', value: '' };
            } else if (trimmed && !trimmed.startsWith('****')) {
                result = { status: 'set', value: trimmed };
            } else {
                result = { status: 'skip' };
            }
            break;
        }
        case 'text':
        default:
            result = typeof value === 'string'
                ? { status: 'set', value: value.trim() }
                : { status: 'reject', reason: `${field.key} must be a string` };
            break;
    }
    return result;
}

/**
 * Controller for `/api/admin/system/providers/*`. Stateless beyond its injected
 * collaborators; one instance is mounted by the module.
 */
export class ProvidersController {
    private readonly configService: ProviderConfigService;
    private readonly registry: IProviderRegistry;
    private readonly tronGridClient: TronGridProviderClient;
    private readonly logger: ISystemLogService;

    /**
     * @param configService - DB-backed provider config (masked reads, guarded writes).
     * @param registry - The vendor registry the generic handlers resolve a vendor from.
     * @param tronGridClient - TronGrid transport for the staged config's connectivity test.
     * @param logger - Child logger for request diagnostics.
     */
    constructor(
        configService: ProviderConfigService,
        registry: IProviderRegistry,
        tronGridClient: TronGridProviderClient,
        logger: ISystemLogService
    ) {
        this.configService = configService;
        this.registry = registry;
        this.tronGridClient = tronGridClient;
        this.logger = logger;
    }

    /**
     * Resolve the vendor named in the route, answering 404 when none is
     * registered so a typo in the id is distinguishable from a storage failure.
     *
     * @param req - Route param `id`.
     * @param res - Written to only on failure.
     * @returns The vendor, or null after a 404 has been sent.
     */
    private resolveVendor(req: Request, res: Response): IProviderVendor | null {
        const vendor = this.registry.getVendor(String(req.params.id ?? ''));
        if (!vendor) {
            res.status(404).json({ success: false, error: 'Unknown provider' });
            return null;
        }
        return vendor;
    }

    /**
     * The masked config for a vendor, taking the bespoke path for TronGrid whose
     * key pool the generic masker does not know about.
     *
     * @param vendor - The vendor to read.
     * @returns The masked config.
     */
    private async maskedConfigFor(vendor: IProviderVendor): Promise<Record<string, unknown>> {
        if (vendor.descriptor.id === 'trongrid') {
            return (await this.configService.getMaskedTronGridConfig()) as unknown as Record<string, unknown>;
        }
        return this.configService.getMaskedConfig(vendor.descriptor, vendor.defaults);
    }

    /**
     * GET / — every registered vendor with its descriptor and masked config, in
     * registration order, so the admin surface renders one card per vendor
     * without knowing any vendor by name.
     *
     * @param _req - Unused.
     * @param res - JSON `{ success, providers: [{ ...descriptor, config }] }`.
     */
    listProviders = async (_req: Request, res: Response): Promise<void> => {
        try {
            const providers = await Promise.all(
                this.registry.listVendors().map(async (vendor) => ({
                    ...vendor.descriptor,
                    config: await this.maskedConfigFor(vendor)
                }))
            );
            res.json({ success: true, providers });
        } catch (error) {
            this.logger.error({ error }, 'Failed to list providers');
            res.status(500).json({ success: false, error: 'Failed to list providers' });
        }
    };

    /**
     * GET /:id — one vendor's masked config for its admin card.
     *
     * @param req - Route param `id`.
     * @param res - JSON `{ success, config }` with secrets masked, or 404.
     */
    getProviderConfig = async (req: Request, res: Response): Promise<void> => {
        const vendor = this.resolveVendor(req, res);
        if (!vendor) {
            return;
        }
        try {
            res.json({ success: true, config: await this.maskedConfigFor(vendor) });
        } catch (error) {
            this.logger.error({ error, vendor: vendor.descriptor.id }, 'Failed to read provider config');
            res.status(500).json({ success: false, error: 'Failed to read provider config' });
        }
    };

    /**
     * PUT /:id — persist a partial config update validated field by field
     * against the vendor's descriptor. Any refused field fails the whole save
     * with a 400 listing every reason, so the operator fixes them in one pass.
     * TronGrid is refused here and directed to its own route, because its save
     * rules involve a key pool this handler must never touch.
     *
     * @param req - Route param `id`; body carries descriptor fields.
     * @param res - JSON `{ success, config }` with the new masked config, 400 with the reasons, or 404.
     */
    updateProviderConfig = async (req: Request, res: Response): Promise<void> => {
        const vendor = this.resolveVendor(req, res);
        if (!vendor) {
            return;
        }
        if (vendor.descriptor.custom) {
            res.status(400).json({ success: false, error: 'This provider is edited through its own routes' });
            return;
        }
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const updates: Record<string, unknown> = {};
            const rejected: string[] = [];
            for (const field of vendor.descriptor.fields) {
                const outcome = validateField(field, body[field.key]);
                if (outcome.status === 'set') {
                    updates[field.key] = outcome.value;
                } else if (outcome.status === 'reject') {
                    rejected.push(outcome.reason);
                }
            }
            if (rejected.length > 0) {
                res.status(400).json({ success: false, error: rejected.join('; ') });
                return;
            }
            const config = await this.configService.saveConfig(vendor.descriptor, vendor.defaults, updates);
            res.json({ success: true, config });
        } catch (error) {
            this.logger.error({ error, vendor: vendor.descriptor.id }, 'Failed to update provider config');
            res.status(500).json({ success: false, error: 'Failed to update provider config' });
        }
    };

    /**
     * POST /:id/test — run the vendor's live connectivity/credential check and
     * return the structured outcome. Never 500s on an upstream failure: a failed
     * test is a `200` with `result.ok === false` so the form can render the
     * reason inline.
     *
     * @param req - Route param `id`.
     * @param res - JSON `{ success, result }` where `result` carries ok/message/latency, or 404.
     */
    testProvider = async (req: Request, res: Response): Promise<void> => {
        const vendor = this.resolveVendor(req, res);
        if (!vendor) {
            return;
        }
        try {
            const result = await vendor.testConnection();
            res.json({ success: result.ok, result });
        } catch (error) {
            this.logger.error({ error, vendor: vendor.descriptor.id }, 'Provider test threw unexpectedly');
            res.status(500).json({ success: false, error: 'Provider test failed' });
        }
    };

    /**
     * GET /trongrid — return the masked TronGrid config for the admin form.
     *
     * @param _req - Unused.
     * @param res - JSON `{ success, config }` with every key masked.
     */
    getTronGridConfig = async (_req: Request, res: Response): Promise<void> => {
        try {
            const config = await this.configService.getMaskedTronGridConfig();
            res.json({ success: true, config });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read TronGrid provider config');
            res.status(500).json({ success: false, error: 'Failed to read provider config' });
        }
    };

    /**
     * PUT /trongrid — persist the non-secret fields. API keys are not accepted
     * here; they are added and removed through the dedicated key endpoints so a
     * masked value can never be written back over a real one.
     *
     * @param req - Body with optional `enabled`, `fetchBlockReceipts`, `baseUrl`, `requestThrottleMs`, `maxQueueSize`, `requestTimeoutMs`.
     * @param res - JSON `{ success, config }` with the new masked config, or 400 listing every field that was refused.
     */
    updateTronGridConfig = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const updates: Partial<Omit<ITronGridProviderConfig, 'apiKeys'>> = {};

            // Present-but-unusable is an operator error worth reporting; absent is
            // simply a field this request does not change.
            const rejected: string[] = [];

            if (typeof body.enabled === 'boolean') {
                updates.enabled = body.enabled;
            }
            // Only a real boolean is accepted. This flag drives live sync
            // behaviour, so a truthy string such as "false" must not switch it on
            // behind a 200 response — the operator would have no way to tell from
            // the form that they had just doubled the upstream call rate.
            if (typeof body.fetchBlockReceipts === 'boolean') {
                updates.fetchBlockReceipts = body.fetchBlockReceipts;
            } else if (body.fetchBlockReceipts !== undefined) {
                rejected.push('fetchBlockReceipts must be true or false');
            }
            if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
                const normalizedBaseUrl = normalizeBaseUrl(body.baseUrl);
                if (normalizedBaseUrl) {
                    updates.baseUrl = normalizedBaseUrl;
                } else {
                    rejected.push(INVALID_BASE_URL_MESSAGE);
                }
            }

            const throttle = readBoundedInteger(body.requestThrottleMs, TRONGRID_LIMITS.requestThrottleMs);
            const queueSize = readBoundedInteger(body.maxQueueSize, TRONGRID_LIMITS.maxQueueSize);
            const timeout = readBoundedInteger(body.requestTimeoutMs, TRONGRID_LIMITS.requestTimeoutMs);

            if (body.requestThrottleMs !== undefined && throttle === undefined) {
                rejected.push(
                    `requestThrottleMs must be a whole number between ${TRONGRID_LIMITS.requestThrottleMs.min} and ${TRONGRID_LIMITS.requestThrottleMs.max}`
                );
            }
            if (body.maxQueueSize !== undefined && queueSize === undefined) {
                rejected.push(
                    `maxQueueSize must be a whole number between ${TRONGRID_LIMITS.maxQueueSize.min} and ${TRONGRID_LIMITS.maxQueueSize.max}`
                );
            }
            if (body.requestTimeoutMs !== undefined && timeout === undefined) {
                rejected.push(
                    `requestTimeoutMs must be a whole number between ${TRONGRID_LIMITS.requestTimeoutMs.min} and ${TRONGRID_LIMITS.requestTimeoutMs.max}`
                );
            }
            if (rejected.length > 0) {
                res.status(400).json({ success: false, error: rejected.join('; ') });
                return;
            }

            if (throttle !== undefined) {
                updates.requestThrottleMs = throttle;
            }
            if (queueSize !== undefined) {
                updates.maxQueueSize = queueSize;
            }
            if (timeout !== undefined) {
                updates.requestTimeoutMs = timeout;
            }

            const config = await this.configService.saveTronGridConfig(updates);
            res.json({ success: true, config });
        } catch (error) {
            this.logger.error({ error }, 'Failed to update TronGrid provider config');
            res.status(500).json({ success: false, error: 'Failed to update provider config' });
        }
    };

    /**
     * POST /trongrid/keys — append a key to the rotation pool.
     *
     * @param req - Body with `apiKey`.
     * @param res - JSON `{ success, config }`, or 400 with the reason the key was refused.
     */
    addTronGridApiKey = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            if (typeof body.apiKey !== 'string') {
                res.status(400).json({ success: false, error: 'An API key is required.' });
                return;
            }
            const config = await this.configService.addTronGridApiKey(body.apiKey);
            res.json({ success: true, config });
        } catch (error) {
            if (error instanceof ProviderConfigValidationError) {
                res.status(400).json({ success: false, error: error.message });
                return;
            }
            this.logger.error({ error }, 'Failed to add TronGrid API key');
            res.status(500).json({ success: false, error: 'Failed to add API key' });
        }
    };

    /**
     * DELETE /trongrid/keys/:index — drop the key at a rotation position. The UI
     * only ever holds masked values, so position is the shared handle.
     *
     * @param req - Route param `index` (zero-based).
     * @param res - JSON `{ success, config }`, or 400 when no key occupies that position.
     */
    removeTronGridApiKey = async (req: Request, res: Response): Promise<void> => {
        try {
            const index = Number(req.params.index);
            const config = await this.configService.removeTronGridApiKey(index);
            res.json({ success: true, config });
        } catch (error) {
            if (error instanceof ProviderConfigValidationError) {
                res.status(400).json({ success: false, error: error.message });
                return;
            }
            this.logger.error({ error }, 'Failed to remove TronGrid API key');
            res.status(500).json({ success: false, error: 'Failed to remove API key' });
        }
    };

    /**
     * POST /trongrid/test — probe the saved TronGrid config, one call per stored
     * key. Never 500s on an upstream failure: a failed probe is a `200` with
     * `result.ok === false` so the form can render the reason per key.
     *
     * @param _req - Unused.
     * @param res - JSON `{ success, result }` carrying the aggregate and per-key outcomes.
     */
    testTronGrid = async (_req: Request, res: Response): Promise<void> => {
        try {
            const result = await this.tronGridClient.testConnection();
            res.json({ success: result.ok, result });
        } catch (error) {
            this.logger.error({ error }, 'TronGrid provider test threw unexpectedly');
            res.status(500).json({ success: false, error: 'Provider test failed' });
        }
    };
}
