/**
 * @fileoverview Public API barrel for the notifications frontend module. The
 * admin page and the account page import the tab components and the shared
 * preferences panel from here; API helpers are re-exported for any consumer.
 */

export { PreferencesPanel } from './components/PreferencesPanel';
export { CategoriesTab } from './components/CategoriesTab';
export { ChannelsTab } from './components/ChannelsTab';
export { HistoryTab } from './components/HistoryTab';
export {
    getMyPreferences,
    updateMyPreferences,
    getAdminCategories,
    setAdminCategory,
    getAdminChannels,
    setAdminChannel,
    getHistory
} from './api/notifications.api';
export type { IAdminCategory, IAdminChannel, IAuditRecordView, IPreferencesBundle } from './api/notifications.api';
