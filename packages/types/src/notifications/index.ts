/**
 * @fileoverview Barrel for the notifications domain types. Re-exported from the
 * package root so consumers import from `@/types` (backend) or
 * `@delphian/tronrelic-types` (plugins) without reaching into sub-paths.
 */

export type {
    NotificationSeverity,
    NotificationContentFeature,
    NotificationDisposer,
    INotificationAudience,
    INotificationCategory,
    INotificationRecipient,
    IRenderedNotification,
    IChannelDeliveryResult,
    INotificationChannel,
    INotificationRequest,
    INotificationChannelTally,
    INotificationReceipt,
    INotificationChannelInfo,
    INotificationService
} from './INotificationService.js';

export type {
    INotificationPreferences,
    INotificationPreferenceUpdate,
    INotificationPolicy,
    INotificationAuditRecord,
    INotificationAuditQuery
} from './INotificationStore.js';
