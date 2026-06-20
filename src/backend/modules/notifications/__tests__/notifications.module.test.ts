/**
 * @fileoverview Tests for the notifications module: the dispatch pipeline's
 * gating (the heart of the feature) and the module's two-phase lifecycle.
 *
 * The dispatch tests exercise the real services against the in-memory database
 * mock so audience resolution, preference enforcement, and audit all run end to
 * end. Per-user preferences are `userId`-keyed (the mock's upsert handles
 * those); the singleton policy document is `_id`-keyed, which the mock's upsert
 * cannot round-trip, so the one policy-gate test seeds the document directly to
 * exercise the dispatch read path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ADMIN_GROUP_ID } from '@/types';
import type {
    ISystemLogService,
    IUserGroupService,
    INotificationChannel,
    INotificationRecipient,
    IRenderedNotification,
    INotificationCategory
} from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { NotificationsModule } from '../index.js';
import { NotificationService } from '../services/notification.service.js';
import { CategoryRegistry } from '../services/category-registry.js';
import { ChannelRegistry } from '../services/channel-registry.js';
import { PreferenceService } from '../services/preference.service.js';
import { PolicyService } from '../services/policy.service.js';
import { AuditService } from '../services/audit.service.js';
import { RecipientResolver } from '../services/recipient-resolver.js';
import { DispatchService } from '../services/dispatch.service.js';
import { AUDIT_COLLECTION, POLICY_COLLECTION, POLICY_DOC_ID } from '../config.js';

/** No-op logger satisfying ISystemLogService for the services under test. */
function silentLogger(): ISystemLogService {
    const noop = (): void => undefined;
    const logger = {
        info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

/** A recording channel standing in for the toast transport. */
function recordingChannel(): { channel: INotificationChannel; calls: Array<{ recipients: string[]; message: IRenderedNotification }> } {
    const calls: Array<{ recipients: string[]; message: IRenderedNotification }> = [];
    const channel: INotificationChannel = {
        id: 'toast',
        label: 'Toast',
        deliver: async (recipients: INotificationRecipient[], message: IRenderedNotification) => {
            calls.push({ recipients: recipients.map((r) => r.userId), message });
            return { delivered: recipients.length };
        }
    };
    return { channel, calls };
}

/** A fake `'user-groups'` service whose admin group has two members. */
function fakeUserGroups(): IUserGroupService {
    return {
        getMembers: async (groupId: string) =>
            groupId === ADMIN_GROUP_ID ? { userIds: ['admin1', 'admin2'], total: 2 } : { userIds: [], total: 0 }
    } as unknown as IUserGroupService;
}

const TEST_CATEGORY: INotificationCategory = {
    id: 'test.cat',
    label: 'Test category',
    description: 'A category for tests.',
    source: 'test',
    defaultAudience: { groups: [ADMIN_GROUP_ID] },
    supportedChannels: ['toast'],
    channelDefaults: { toast: true },
    userConfigurable: true,
    mutable: true
};

describe('Notifications dispatch pipeline', () => {
    let db: ReturnType<typeof createMockDatabaseService>;
    let categories: CategoryRegistry;
    let channels: ChannelRegistry;
    let preferences: PreferenceService;
    let policy: PolicyService;
    let audit: AuditService;
    let dispatch: DispatchService;
    let calls: Array<{ recipients: string[]; message: IRenderedNotification }>;

    beforeEach(() => {
        const logger = silentLogger();
        db = createMockDatabaseService();
        categories = new CategoryRegistry(logger);
        channels = new ChannelRegistry(logger);
        preferences = new PreferenceService(db, logger);
        policy = new PolicyService(db, logger);
        audit = new AuditService(db, logger);
        const resolver = new RecipientResolver(() => fakeUserGroups(), logger);
        dispatch = new DispatchService(categories, channels, preferences, policy, audit, resolver, logger);

        const rec = recordingChannel();
        calls = rec.calls;
        channels.register(rec.channel);
        categories.register(TEST_CATEGORY);
    });

    it('delivers to every audience member by default', async () => {
        const receipt = await dispatch.notify({ category: 'test.cat', title: 'Hello' });

        expect(receipt.recipientCount).toBe(2);
        expect(receipt.delivered).toBe(2);
        expect(receipt.suppressed).toBe(0);
        expect(calls).toHaveLength(1);
        expect([...calls[0].recipients].sort()).toEqual(['admin1', 'admin2']);
    });

    it('suppresses a recipient who opted out of the pairing', async () => {
        await preferences.update('admin2', { overrides: { 'test.cat': { toast: false } } });

        const receipt = await dispatch.notify({ category: 'test.cat', title: 'Hello' });

        expect(receipt.delivered).toBe(1);
        expect(receipt.suppressed).toBe(1);
        expect(calls[0].recipients).toEqual(['admin1']);
    });

    it('suppresses a recipient who muted everything', async () => {
        await preferences.update('admin1', { mutedAll: true });

        const receipt = await dispatch.notify({ category: 'test.cat', title: 'Hello' });

        expect(receipt.delivered).toBe(1);
        expect(calls[0].recipients).toEqual(['admin2']);
    });

    it('suppresses every channel when admin policy disables the category', async () => {
        // Seed the policy document directly — the dispatch read path is what we
        // exercise here, and the mock's upsert cannot round-trip the _id-keyed
        // singleton the service would otherwise write.
        db.getCollectionData(POLICY_COLLECTION).push({
            _id: POLICY_DOC_ID,
            categories: { 'test.cat': false },
            channels: {},
            updatedAt: new Date()
        });

        const receipt = await dispatch.notify({ category: 'test.cat', title: 'Hello' });

        expect(receipt.delivered).toBe(0);
        expect(receipt.suppressed).toBe(2);
        expect(calls).toHaveLength(0);
    });

    it('records an audit row with delivered and suppressed counts', async () => {
        await preferences.update('admin2', { overrides: { 'test.cat': { toast: false } } });
        await dispatch.notify({ category: 'test.cat', title: 'Hello', firedBy: 'prompt-1' });

        const rows = db.getCollectionData(AUDIT_COLLECTION);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            categoryId: 'test.cat',
            categoryLabel: 'Test category',
            source: 'test',
            recipientCount: 2,
            suppressedCount: 1,
            firedBy: 'prompt-1'
        });
        expect(rows[0].channels[0]).toMatchObject({ channelId: 'toast', delivered: 1, suppressed: 1 });
    });

    it('throws when firing an unregistered category', async () => {
        await expect(dispatch.notify({ category: 'does.not.exist', title: 'x' })).rejects.toThrow(/not registered/);
    });
});

describe('NotificationsModule lifecycle', () => {
    let db: ReturnType<typeof createMockDatabaseService>;
    let app: { use: ReturnType<typeof vi.fn> };
    let menuService: { create: ReturnType<typeof vi.fn> };
    let registry: ReturnType<typeof createMockServiceRegistry>;

    beforeEach(() => {
        NotificationService.__resetForTests();
        db = createMockDatabaseService();
        app = { use: vi.fn() };
        menuService = { create: vi.fn(async () => undefined) };
        registry = createMockServiceRegistry();
    });

    /** Build the dependency bundle the module's init expects. */
    function deps() {
        return { database: db, menuService: menuService as never, serviceRegistry: registry, app: app as never };
    }

    it('has correct metadata', () => {
        const module = new NotificationsModule();
        expect(module.metadata.id).toBe('notifications');
        expect(module.metadata.name).toBe('Notifications');
    });

    it('does not mount routes during init()', async () => {
        const module = new NotificationsModule();
        await module.init(deps());
        expect(app.use).not.toHaveBeenCalled();
    });

    it('mounts routes, registers the service, and seeds the menu during run()', async () => {
        const module = new NotificationsModule();
        await module.init(deps());
        await module.run();

        expect(app.use).toHaveBeenCalledWith('/api/notifications', expect.any(Function));
        expect(registry.has('notifications')).toBe(true);
        expect(menuService.create).toHaveBeenCalledTimes(1);
    });
});
