/**
 * @fileoverview Stored shape of a published route.
 */

import type { ObjectId } from 'mongodb';

/**
 * One document in `module_localization_routes`, unique on `pattern`. The wire
 * form is `ILocalizedRoute`, which exposes `_id` as the string `id`.
 */
export interface ILocalizedRouteDocument {
    /** Mongo identifier, exposed to the admin API as `id`. */
    _id: ObjectId;
    /** Route pattern in the `matchRoutePattern` syntax. */
    pattern: string;
    /** Language codes the route is published in. */
    languages: string[];
    /** When the entry last changed. */
    updatedAt: Date;
}
