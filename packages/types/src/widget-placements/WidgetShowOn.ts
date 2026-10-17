/**
 * @fileoverview Which class of screen a widget placement renders on.
 *
 * @module types/widget-placements/WidgetShowOn
 */

/**
 * Limits a placement to phone-sized or larger screens.
 *
 * Some navigation belongs to one kind of device only. When the mobile tab bar
 * is in use, the header menu duplicates it on a phone, while the tab bar has
 * no place on a desktop. An operator therefore marks a placement as
 * `mobile` (shown only when the page is 768px wide or narrower) or
 * `desktop` (shown only above that width). A placement without the setting
 * renders on every screen, which is how every placement behaved before the
 * setting existed.
 *
 * The threshold is the width of the page's `<body>`, not the width of the
 * zone the widget sits in. That is deliberate: the setting exists to pair
 * with the mobile tab bar zone, which is shown by the same `<body>` width
 * rule, so the header menu hides at exactly the width the tab bar appears
 * and no width is left with neither.
 */
export type WidgetShowOn = 'mobile' | 'desktop';
