/**
 * @fileoverview Public API for the database admin module.
 *
 * Exposes the storage browsers used by the system console and republished to
 * plugins on `context.system`, so a plugin admin page can inspect its own
 * collections and tables without a cross-workspace import.
 *
 * @module modules/database
 */

export { CollectionBrowser } from './components/CollectionBrowser';
export { ClickHouseTableBrowser } from './components/ClickHouseTableBrowser';
