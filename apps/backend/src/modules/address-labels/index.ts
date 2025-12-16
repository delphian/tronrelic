/**
 * Address labels module public API.
 *
 * Exports the module class, service, and types for external consumption.
 */

export { AddressLabelsModule } from './AddressLabelsModule.js';
export type { IAddressLabelsModuleDependencies } from './AddressLabelsModule.js';
export { AddressLabelService } from './services/index.js';
export type { IAddressLabelStats } from './services/index.js';
export { AddressLabelController } from './api/index.js';
export type { IAddressLabelDocument } from './database/index.js';
