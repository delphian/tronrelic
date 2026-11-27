/**
 * @fileoverview Server-only exports of the menu module.
 *
 * Kept apart from the module's `index.ts` because these run during server
 * rendering and would drag server-only code into client bundles if the
 * client barrel re-exported them.
 *
 * @module modules/menu/server
 */

export { fetchMenuNamespace } from './lib/fetchMenuNamespace';
export { fetchMenuCategory } from './lib/fetchMenuCategory';
export { CATEGORY_MENU_NAMESPACE } from './lib/CATEGORY_MENU_NAMESPACE';
export type { IMenuCategory } from './types/IMenuCategory';
