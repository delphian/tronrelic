/**
 * @fileoverview Public API of the address-tags module.
 *
 * Bootstrap imports the module class; the service and controllers are
 * exported for tests. External consumers resolve the service through the
 * registry (`'address-tags'`), not through this barrel.
 */

export { AddressTagsModule } from './AddressTagsModule.js';
export type { IAddressTagsModuleDependencies } from './AddressTagsModule.js';
export { AddressTagService, ADDRESS_TAGS_COLLECTION } from './services/address-tag.service.js';
export type { IAddressTagServiceDependencies } from './services/address-tag.service.js';
export { AddressTagsUserController } from './api/address-tags-user.controller.js';
export { AddressTagsAdminController } from './api/address-tags-admin.controller.js';
