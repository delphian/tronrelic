/**
 * @fileoverview Namespace for text rendered by core rather than by a plugin.
 *
 * Kept in its own file, outside the `'use client'` hook, so server code can
 * import the value. A server component that imports a constant from a
 * `'use client'` file receives a client reference instead of the string.
 *
 * @module modules/localization/lib/CORE_TRANSLATION_NAMESPACE
 */

/** Namespace for text rendered by core components rather than plugins. */
export const CORE_TRANSLATION_NAMESPACE = 'core';
