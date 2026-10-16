/**
 * Widget system type definitions.
 *
 * Provides the unified `IWidgetsService` interface published on the
 * service registry, the SSR data shape returned by
 * `fetchWidgetsForRoute`, and the React component contract widget
 * frontends implement.
 */

export type { IWidgetData } from './IWidgetData.js';
export type { IWidgetComponentProps, WidgetComponent } from './IWidgetComponentProps.js';
export type {
    IWidgetsService,
    IRegisterWidgetTypeInput,
    IRegisterZoneInput,
    IRegisterWidgetInput,
    WidgetsRegistrationDisposer
} from './IWidgetsService.js';
export type { IAuthButtonLink } from './IAuthButtonLink.js';
export { WIDGET_ICON_FORMAT } from './WIDGET_ICON_FORMAT.js';
export { WIDGET_IMAGE_FORMAT } from './WIDGET_IMAGE_FORMAT.js';
export { WIDGET_MENU_NAMESPACE_FORMAT } from './WIDGET_MENU_NAMESPACE_FORMAT.js';
