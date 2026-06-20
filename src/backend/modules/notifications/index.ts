/**
 * @fileoverview Public API barrel for the notifications module. Bootstrap
 * imports the module class; tests reach the service and document shapes.
 */

export { NotificationsModule } from './NotificationsModule.js';
export type { INotificationsModuleDependencies } from './NotificationsModule.js';
export { NotificationService } from './services/notification.service.js';
export { NOTIFICATIONS_SERVICE } from './config.js';
export type {
    INotificationPreferencesDocument,
    INotificationPolicyDocument,
    INotificationAuditDocument
} from './database/index.js';
