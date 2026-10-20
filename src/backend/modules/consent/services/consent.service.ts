/**
 * @fileoverview The consent module's settings and the read side other code
 * depends on, published as `'consent'`.
 *
 * Every page request needs the settings, through the middleware's poll of the
 * public config, and every page-view beacon needs them to resolve the
 * visitor's consent. They change only when an administrator saves the
 * Settings tab, so the service keeps the public config in memory and reloads
 * it only after a save.
 */

import type {
    IConsentPublicConfig,
    IConsentService,
    IConsentSettings,
    IConsentState,
    IDatabaseService,
    ISystemLogService
} from '@/types';
import { GOOGLE_ADS_CONVERSION_LABEL_PATTERN, GOOGLE_ADS_ID_PATTERN, resolveConsentState } from '@/types';
import type { IConsentSettingsDocument } from '../database/index.js';
import { SETTINGS_COLLECTION } from '../database/index.js';
import { ConsentValidationError } from './consent-errors.js';

/**
 * Settings in force before an administrator saves anything. The main switch
 * starts off so that deploying the module changes nothing until someone turns
 * it on from `/system/consent`.
 */
const DEFAULT_SETTINGS: IConsentPublicConfig = {
    enabled: false,
    policyVersion: 1,
    googleAdsId: null,
    conversionLabel: null
};

/** Fields an administrator may change from the Settings tab. */
export interface IConsentSettingsPatch {
    /** Turn the banner, the analytics gate, and the Google Ads tag on or off. */
    enabled?: boolean;
    /** New Google Ads tag id, or null or an empty string to remove it. */
    googleAdsId?: string | null;
    /** New conversion label, or null or an empty string to stop recording conversions. */
    conversionLabel?: string | null;
}

/** Dependencies injected once at bootstrap. */
export interface IConsentServiceDependencies {
    /** Core database service; collection names carry the module prefix. */
    database: IDatabaseService;
    /** Module-scoped logger; every save is recorded with the actor. */
    logger: ISystemLogService;
}

/**
 * Singleton implementation of `IConsentService`.
 *
 * Follows the `setDependencies()` / `getInstance()` pattern because the cached
 * config is shared state: the admin save, the public route, and the traffic
 * module's beacon check must all see the same value and the same invalidation.
 */
export class ConsentService implements IConsentService {
    private static instance: ConsentService | null = null;

    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;

    /**
     * The public config being served, or the load in progress. Holding the
     * promise rather than the value means concurrent requests after a save
     * share one database read.
     */
    private publicConfig: Promise<IConsentPublicConfig> | null = null;

    /**
     * Private so construction only happens through `setDependencies`.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    private constructor(deps: IConsentServiceDependencies) {
        this.database = deps.database;
        this.logger = deps.logger;
    }

    /**
     * Wire the singleton. The first call constructs it; later calls are no-ops
     * so bootstrap and tests cannot configure two instances.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    public static setDependencies(deps: IConsentServiceDependencies): void {
        if (!ConsentService.instance) {
            ConsentService.instance = new ConsentService(deps);
        }
    }

    /**
     * Return the configured singleton.
     *
     * @returns The shared service.
     * @throws When `setDependencies` has not run, which is a bootstrap ordering bug.
     */
    public static getInstance(): ConsentService {
        if (!ConsentService.instance) {
            throw new Error('ConsentService.setDependencies() must be called before getInstance()');
        }
        return ConsentService.instance;
    }

    /**
     * Drop the singleton so each test can wire fresh mocks.
     */
    public static resetForTests(): void {
        ConsentService.instance = null;
    }

    /**
     * Discard the cached public config so the next read reloads it. Called
     * after every save, which is what makes a change visible to the next
     * request rather than after a restart.
     */
    public invalidate(): void {
        this.publicConfig = null;
    }

    /** @inheritdoc */
    public async getPublicConfig(): Promise<IConsentPublicConfig> {
        if (!this.publicConfig) {
            const load = this.loadPublicConfig();
            this.publicConfig = load;
            // A failed load must not stay cached, or one database hiccup would
            // pin every request to that error until the next save.
            load.catch(() => {
                if (this.publicConfig === load) {
                    this.publicConfig = null;
                }
            });
        }
        return this.publicConfig;
    }

    /** @inheritdoc */
    public async resolveRequest(
        country: string | null | undefined,
        cookieValue: string | null | undefined
    ): Promise<IConsentState> {
        return resolveConsentState(await this.getPublicConfig(), country, cookieValue);
    }

    /**
     * Read the settings with who saved them last, for the admin page.
     *
     * @returns The settings in their wire form, with defaults for anything never saved.
     */
    public async getSettings(): Promise<IConsentSettings> {
        const document = await this.collection().findOne({ key: 'settings' });
        return {
            enabled: document?.enabled ?? DEFAULT_SETTINGS.enabled,
            policyVersion: document?.policyVersion ?? DEFAULT_SETTINGS.policyVersion,
            googleAdsId: document?.googleAdsId ?? DEFAULT_SETTINGS.googleAdsId,
            conversionLabel: document?.conversionLabel ?? DEFAULT_SETTINGS.conversionLabel,
            updatedAt: document?.updatedAt ? document.updatedAt.toISOString() : null,
            updatedBy: document?.updatedBy ?? null
        };
    }

    /**
     * Change the main switch, the Google Ads id, or the conversion label.
     *
     * Turning the main switch on or off is logged as a warning rather than as
     * information, because it changes what every visitor in the EEA, the UK,
     * and Switzerland is shown and which cookies they receive.
     *
     * @param patch - Fields to change.
     * @param actor - Who made the change, recorded on the document and in the log.
     * @returns The settings after the change.
     * @throws ConsentValidationError for a value in the wrong form.
     */
    public async updateSettings(patch: IConsentSettingsPatch, actor: string): Promise<IConsentSettings> {
        const current = await this.getSettings();
        const next: IConsentSettingsDocument = {
            key: 'settings',
            enabled: current.enabled,
            policyVersion: current.policyVersion,
            googleAdsId: current.googleAdsId,
            conversionLabel: current.conversionLabel,
            updatedAt: new Date(),
            updatedBy: actor
        };

        if (patch.enabled !== undefined) {
            if (typeof patch.enabled !== 'boolean') {
                throw new ConsentValidationError('Invalid enabled flag: expected true or false');
            }
            next.enabled = patch.enabled;
        }
        if (patch.googleAdsId !== undefined) {
            next.googleAdsId = this.optionalMatch(patch.googleAdsId, GOOGLE_ADS_ID_PATTERN, 'Google Ads id', 'AW- followed by digits');
        }
        if (patch.conversionLabel !== undefined) {
            next.conversionLabel = this.optionalMatch(
                patch.conversionLabel,
                GOOGLE_ADS_CONVERSION_LABEL_PATTERN,
                'conversion label',
                'letters, digits, hyphens, and underscores'
            );
        }

        await this.collection().updateOne({ key: 'settings' }, { $set: next }, { upsert: true });
        this.invalidate();

        const details = { actor, enabled: next.enabled, googleAdsId: next.googleAdsId, conversionLabel: next.conversionLabel };
        if (next.enabled !== current.enabled) {
            this.logger.warn(details, `Consent handling switched ${next.enabled ? 'on' : 'off'}`);
        } else {
            this.logger.info(details, 'Consent settings saved');
        }
        return this.getSettings();
    }

    /**
     * Raise the policy version so every visitor in a consent region is asked
     * again on their next page view. Used after the Privacy Policy changes in
     * a way visitors should agree to afresh.
     *
     * @param actor - Who asked for it, recorded on the document and in the log.
     * @returns The settings after the change.
     */
    public async renewConsent(actor: string): Promise<IConsentSettings> {
        const current = await this.getSettings();
        const policyVersion = current.policyVersion + 1;
        await this.collection().updateOne(
            { key: 'settings' },
            {
                $set: {
                    key: 'settings',
                    enabled: current.enabled,
                    policyVersion,
                    googleAdsId: current.googleAdsId,
                    conversionLabel: current.conversionLabel,
                    updatedAt: new Date(),
                    updatedBy: actor
                }
            },
            { upsert: true }
        );
        this.invalidate();
        this.logger.warn({ actor, policyVersion }, 'Consent policy version raised; visitors in consent regions will be asked again');
        return this.getSettings();
    }

    /**
     * Load the public config from storage, without the audit fields.
     *
     * @returns The settings every request needs.
     */
    private async loadPublicConfig(): Promise<IConsentPublicConfig> {
        const settings = await this.getSettings();
        return {
            enabled: settings.enabled,
            policyVersion: settings.policyVersion,
            googleAdsId: settings.googleAdsId,
            conversionLabel: settings.conversionLabel
        };
    }

    /**
     * Validate an optional value against a pattern. An empty string means the
     * same as null, which is what a cleared text field sends.
     *
     * @param value - Candidate value from the request.
     * @param pattern - The form the value must take.
     * @param label - Field name used in the error message.
     * @param expected - Plain description of the form, used in the error message.
     * @returns The trimmed value, or null.
     * @throws ConsentValidationError when the value is present and does not match.
     */
    private optionalMatch(value: unknown, pattern: RegExp, label: string, expected: string): string | null {
        let result: string | null = null;
        if (value !== null) {
            const trimmed = typeof value === 'string' ? value.trim() : null;
            if (trimmed === null || (trimmed !== '' && !pattern.test(trimmed))) {
                throw new ConsentValidationError(`Invalid ${label}: expected ${expected}`);
            }
            result = trimmed === '' ? null : trimmed;
        }
        return result;
    }

    /** @returns The settings collection. */
    private collection() {
        return this.database.getCollection<IConsentSettingsDocument>(SETTINGS_COLLECTION);
    }
}
