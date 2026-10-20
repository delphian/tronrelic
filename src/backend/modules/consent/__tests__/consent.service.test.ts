/**
 * @fileoverview Tests for `ConsentService`: defaults before anything is saved,
 * validation of the Google Ads fields, cache invalidation on save, and the
 * renew action that asks visitors again.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { ConsentService } from '../services/consent.service.js';
import { ConsentValidationError } from '../services/consent-errors.js';

/**
 * Build a fresh service over an empty mock database.
 *
 * @returns The service and its logger spies.
 */
function createService() {
    ConsentService.resetForTests();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;
    ConsentService.setDependencies({ database: createMockDatabaseService(), logger });
    return { service: ConsentService.getInstance(), logger };
}

describe('ConsentService', () => {
    beforeEach(() => {
        ConsentService.resetForTests();
    });

    it('starts switched off with policy version 1, so deploying it changes nothing', async () => {
        const { service } = createService();
        expect(await service.getPublicConfig()).toEqual({
            enabled: false,
            policyVersion: 1,
            googleAdsId: null,
            conversionLabel: null
        });
    });

    it('saves the main switch and Google Ads fields and serves them on the next read', async () => {
        const { service } = createService();
        await service.getPublicConfig();
        await service.updateSettings({ enabled: true, googleAdsId: ' AW-123456789 ', conversionLabel: 'AbC-d_1' }, 'admin-1');
        expect(await service.getPublicConfig()).toEqual({
            enabled: true,
            policyVersion: 1,
            googleAdsId: 'AW-123456789',
            conversionLabel: 'AbC-d_1'
        });
        const settings = await service.getSettings();
        expect(settings.updatedBy).toBe('admin-1');
        expect(settings.updatedAt).not.toBeNull();
    });

    it('logs switching consent on or off as a warning', async () => {
        const { service, logger } = createService();
        await service.updateSettings({ enabled: true }, 'admin-1');
        expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ actor: 'admin-1', enabled: true }), 'Consent handling switched on');
    });

    it('treats an empty string as clearing a field', async () => {
        const { service } = createService();
        await service.updateSettings({ googleAdsId: 'AW-123456789', conversionLabel: 'label' }, 'admin-1');
        await service.updateSettings({ googleAdsId: '', conversionLabel: '' }, 'admin-1');
        const settings = await service.getSettings();
        expect(settings.googleAdsId).toBeNull();
        expect(settings.conversionLabel).toBeNull();
    });

    it('refuses a Google Ads id or label in the wrong form, and a non-boolean switch', async () => {
        const { service } = createService();
        await expect(service.updateSettings({ googleAdsId: 'G-ABC123' }, 'admin-1')).rejects.toBeInstanceOf(ConsentValidationError);
        await expect(service.updateSettings({ googleAdsId: 'AW-1"><script>' }, 'admin-1')).rejects.toBeInstanceOf(ConsentValidationError);
        await expect(service.updateSettings({ conversionLabel: 'has space' }, 'admin-1')).rejects.toBeInstanceOf(ConsentValidationError);
        await expect(service.updateSettings({ enabled: 'yes' as unknown as boolean }, 'admin-1')).rejects.toBeInstanceOf(ConsentValidationError);
    });

    it('renewConsent() raises the policy version and keeps the other settings', async () => {
        const { service } = createService();
        await service.updateSettings({ enabled: true, googleAdsId: 'AW-123456789' }, 'admin-1');
        const renewed = await service.renewConsent('admin-2');
        expect(renewed.policyVersion).toBe(2);
        expect(renewed.enabled).toBe(true);
        expect(renewed.googleAdsId).toBe('AW-123456789');
        expect((await service.getPublicConfig()).policyVersion).toBe(2);
    });

    it('resolveRequest() applies the saved settings to the visitor', async () => {
        const { service } = createService();
        expect((await service.resolveRequest('DE', undefined)).analytics).toBe(true);
        await service.updateSettings({ enabled: true }, 'admin-1');
        const state = await service.resolveRequest('DE', undefined);
        expect(state).toEqual({ enabled: true, required: true, decided: false, analytics: false, ads: false });
    });
});
