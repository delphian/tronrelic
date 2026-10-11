/**
 * @fileoverview Tests that the notification preferences surface only offers a
 * user the categories whose audience includes them.
 *
 * Before this check, every user-configurable category reached every signed-in
 * user, so an ordinary user saw toggles for admin-only notifications that could
 * never reach them. These tests cover the audience check on its own
 * (`RecipientResolver.includes`) and both controller paths that depend on it:
 * the catalog returned by GET and the allow-list enforced on PUT.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ADMIN_GROUP_ID } from '@/types';
import type { ISystemLogService, IUserGroupService, INotificationCategory, INotificationChannelInfo } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { UserSettingsService } from '../../identity/services/user-settings.service.js';
import { PreferenceService } from '../services/preference.service.js';
import { RecipientResolver } from '../services/recipient-resolver.js';
import { PreferencesController } from '../api/preferences.controller.js';
import type { NotificationService } from '../services/notification.service.js';

/**
 * No-op logger, so the services under test can log without output.
 *
 * @returns A logger whose methods do nothing.
 */
function silentLogger(): ISystemLogService {
    const noop = (): void => undefined;
    const logger = {
        info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

/**
 * A fake `'user-groups'` service where `admin1` is the only admin, so tests can
 * compare an admin caller with an ordinary one.
 *
 * @returns The subset of `IUserGroupService` the resolver calls.
 */
function fakeUserGroups(): IUserGroupService {
    return {
        getUserGroups: async (userId: string) => (userId === 'admin1' ? [ADMIN_GROUP_ID] : [])
    } as unknown as IUserGroupService;
}

/**
 * Wrap a spy as a `'user-groups'` service, so a test can count how many times
 * the resolver actually reads a user's memberships.
 *
 * @param getUserGroups - The spy standing in for the real membership read.
 * @returns The subset of `IUserGroupService` the resolver calls.
 */
function countingUserGroups(getUserGroups: (userId: string) => Promise<string[]>): IUserGroupService {
    return { getUserGroups } as unknown as IUserGroupService;
}

/**
 * Build a category for the catalog under test.
 *
 * @param id - Category id, used to tell categories apart in assertions.
 * @param defaultAudience - Who the category reaches, which decides visibility.
 * @returns A user-configurable category with a toast default.
 */
function category(id: string, defaultAudience: INotificationCategory['defaultAudience']): INotificationCategory {
    return {
        id,
        label: id,
        description: `${id} for tests.`,
        source: 'test',
        defaultAudience,
        channelDefaults: { toast: true },
        userConfigurable: true
    };
}

const CATEGORIES: INotificationCategory[] = [
    category('admin.only', { groups: [ADMIN_GROUP_ID] }),
    category('named.user', { userIds: ['user1'] }),
    category('everyone.listed', { userIds: ['admin1', 'user1'] }),
    { ...category('locked', { groups: [ADMIN_GROUP_ID] }), userConfigurable: false }
];

const CHANNELS: INotificationChannelInfo[] = [{ id: 'toast', label: 'Toast' } as INotificationChannelInfo];

/**
 * Stand-in for the published notification service, exposing only the two
 * catalog reads the controller makes.
 *
 * @returns An object typed as `NotificationService` for the controller.
 */
function fakeNotifications(): NotificationService {
    return {
        listCategories: () => CATEGORIES,
        listChannels: () => CHANNELS
    } as unknown as NotificationService;
}

/**
 * Build a request carrying a resolved session for the given user.
 *
 * @param userId - Better Auth id of the caller.
 * @param body - Optional request body for PUT.
 * @returns A request the controller can read the session from.
 */
function requestAs(userId: string, body?: unknown): Request {
    return { authSession: { user: { id: userId } }, body } as unknown as Request;
}

/**
 * Build a response that records the status and JSON body the controller sends.
 *
 * @returns The response plus spies to assert on.
 */
function recordingResponse(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
    const json = vi.fn();
    const status = vi.fn();
    const res = { json, status } as unknown as Response;
    status.mockReturnValue(res);
    return { res, status, json };
}

describe('RecipientResolver.includes', () => {
    it('includes a user listed explicitly', async () => {
        const resolver = new RecipientResolver(() => fakeUserGroups(), silentLogger());
        expect(await resolver.includes({ userIds: ['user1'] }, 'user1')).toBe(true);
    });

    it('includes a member of an audience group', async () => {
        const resolver = new RecipientResolver(() => fakeUserGroups(), silentLogger());
        expect(await resolver.includes({ groups: [ADMIN_GROUP_ID] }, 'admin1')).toBe(true);
    });

    it('excludes a user outside every group and id list', async () => {
        const resolver = new RecipientResolver(() => fakeUserGroups(), silentLogger());
        expect(await resolver.includes({ groups: [ADMIN_GROUP_ID] }, 'user1')).toBe(false);
    });

    it('treats group membership as false when user-groups is unavailable', async () => {
        const resolver = new RecipientResolver(() => undefined, silentLogger());
        expect(await resolver.includes({ groups: [ADMIN_GROUP_ID] }, 'admin1')).toBe(false);
    });

    it('skips the group lookup for a user listed explicitly', async () => {
        const getUserGroups = vi.fn(async () => [ADMIN_GROUP_ID]);
        const resolver = new RecipientResolver(() => countingUserGroups(getUserGroups), silentLogger());

        expect(await resolver.includes({ userIds: ['admin1'] }, 'admin1')).toBe(true);
        expect(getUserGroups).not.toHaveBeenCalled();
    });
});

describe('RecipientResolver.audienceTest', () => {
    it('reuses one group lookup across every audience it tests', async () => {
        const getUserGroups = vi.fn(async () => [ADMIN_GROUP_ID]);
        const resolver = new RecipientResolver(() => countingUserGroups(getUserGroups), silentLogger());

        const matches = await resolver.audienceTest('admin1');

        expect(matches({ groups: [ADMIN_GROUP_ID] })).toBe(true);
        expect(matches({ groups: ['other-group'] })).toBe(false);
        expect(matches({ userIds: ['admin1'] })).toBe(true);
        expect(matches({ userIds: ['user1'] })).toBe(false);
        expect(getUserGroups).toHaveBeenCalledTimes(1);
    });

    it('treats every audience as excluding the user when user-groups is unavailable', async () => {
        const resolver = new RecipientResolver(() => undefined, silentLogger());

        const matches = await resolver.audienceTest('admin1');

        expect(matches({ groups: [ADMIN_GROUP_ID] })).toBe(false);
    });
});

describe('PreferencesController audience filtering', () => {
    let controller: PreferencesController;

    beforeEach(() => {
        const logger = silentLogger();
        UserSettingsService.resetForTests();
        UserSettingsService.setDependencies(createMockDatabaseService(), logger);
        const preferences = new PreferenceService(() => UserSettingsService.getInstance(), logger);
        const resolver = new RecipientResolver(() => fakeUserGroups(), logger);
        controller = new PreferencesController(fakeNotifications(), preferences, resolver, logger);
    });

    it('shows an admin the admin-only category', async () => {
        const { res, json } = recordingResponse();
        await controller.getPreferences(requestAs('admin1'), res);

        const ids = json.mock.calls[0][0].categories.map((c: INotificationCategory) => c.id);
        expect(ids).toEqual(['admin.only', 'everyone.listed']);
    });

    it('hides the admin-only category from an ordinary user', async () => {
        const { res, json } = recordingResponse();
        await controller.getPreferences(requestAs('user1'), res);

        const ids = json.mock.calls[0][0].categories.map((c: INotificationCategory) => c.id);
        expect(ids).toEqual(['named.user', 'everyone.listed']);
    });

    it('rejects an override for a category the caller cannot see', async () => {
        const { res, status } = recordingResponse();
        await controller.updatePreferences(
            requestAs('user1', { overrides: { 'admin.only': { toast: false } } }),
            res
        );

        expect(status).toHaveBeenCalledWith(400);
    });

    it('accepts an override for a category the caller can see', async () => {
        const { res, status, json } = recordingResponse();
        await controller.updatePreferences(
            requestAs('user1', { overrides: { 'named.user': { toast: false } } }),
            res
        );

        expect(status).not.toHaveBeenCalled();
        expect(json.mock.calls[0][0].preferences.overrides['named.user']).toEqual({ toast: false });
    });

    it('reads the caller group membership once per request, not once per category', async () => {
        const logger = silentLogger();
        const getUserGroups = vi.fn(async (userId: string) => (userId === 'admin1' ? [ADMIN_GROUP_ID] : []));
        const preferences = new PreferenceService(() => UserSettingsService.getInstance(), logger);
        const resolver = new RecipientResolver(() => countingUserGroups(getUserGroups), logger);
        const counted = new PreferencesController(fakeNotifications(), preferences, resolver, logger);
        const { res } = recordingResponse();

        await counted.getPreferences(requestAs('user1'), res);

        expect(getUserGroups).toHaveBeenCalledTimes(1);
    });
});
