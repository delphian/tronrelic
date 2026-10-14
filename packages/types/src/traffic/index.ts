/**
 * @fileoverview Barrel for the traffic domain contracts.
 *
 * Re-exports the published ignore-list contract so the root types index can
 * surface it with a single explicit export line.
 */

export type { ITrafficIgnoreSubject } from './ITrafficIgnoreSubject.js';
export type { ITrafficIgnoreList } from './ITrafficIgnoreList.js';
