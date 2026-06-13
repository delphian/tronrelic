/**
 * @file index.ts
 *
 * Barrel for the shared egress / SSRF guard consumed by URL-fetching tools and
 * services across core and plugins.
 */

export { isPrivateIp, assertPublicHttpUrl } from './egress.js';
export type { IEgressCheckResult, IEgressCheckOptions } from './egress.js';
