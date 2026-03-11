/**
 * Address label service interface.
 *
 * Defines the contract for address label CRUD operations and queries.
 * This interface enables plugins to access address labels through
 * dependency injection without importing concrete implementations.
 *
 * ## Usage
 *
 * Modules access via dependency injection during init().
 * Plugins access via IPluginContext.addressLabelService.
 *
 * @example
 * ```typescript
 * // In a plugin observer
 * const label = await context.addressLabelService.findByAddress(senderAddress);
 * if (label) {
 *     console.log(`Transaction from ${label.label}`);
 * }
 * ```
 */
export {};
//# sourceMappingURL=IAddressLabelService.js.map