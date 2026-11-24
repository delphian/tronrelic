/**
 * @fileoverview Internal barrel for the wrench menu shared by the identifier chips.
 *
 * Consumed only by the chip components in `components/ui/` (`AddressChip`,
 * `TronTransactionId`). Application and plugin code renders one of the public
 * chips rather than this menu directly.
 */

export { ChipToolsMenu, type ChipToolsMenuEntry, type IChipToolsMenuProps } from './ChipToolsMenu';
