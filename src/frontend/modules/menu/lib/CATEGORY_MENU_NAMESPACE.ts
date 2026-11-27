/**
 * @fileoverview The menu namespace category landing pages resolve in.
 */

/**
 * Menu namespace category pages resolve in.
 *
 * `fetchMenuCategory` calls `/menu/resolve` without a namespace, and the
 * backend then searches `main`, so a category's translation keys, built with
 * `menuTranslationKey`, belong to `main` as well. The landing page, its
 * metadata, and a breadcrumb naming the category all use this constant so
 * they look up the same translation.
 */
export const CATEGORY_MENU_NAMESPACE = 'main';
