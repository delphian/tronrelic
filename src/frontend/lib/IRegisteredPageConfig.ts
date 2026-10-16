/**
 * @fileoverview A plugin page config as the server-side registry returns it.
 */

import type { IPageConfig } from '@/types';

/**
 * A page config whose owning plugin id is known.
 *
 * `IPageConfig.pluginId` is optional because a plugin author never sets it;
 * the registry fills it in when it indexes the plugin's pages. Code that
 * receives a page from the registry, such as the routes that run a page's
 * server fetchers, needs the id to scope the page's translation keys, so the
 * registry returns this narrower type and those callers do not have to guess
 * at a missing id.
 */
export type IRegisteredPageConfig = IPageConfig & { pluginId: string };
