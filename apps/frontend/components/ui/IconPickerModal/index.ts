/**
 * Icon Picker Modal Component
 *
 * Provides a searchable grid interface for selecting Lucide React icons.
 * Displays icon previews with names, supports filtering by name, and
 * handles selection with visual feedback for the currently selected icon.
 *
 * Use LazyIconPickerModal (default export) to avoid bundling all 1,637 icons
 * with the main application. The icon library only loads when the modal opens.
 */

export { IconPickerModal } from './IconPickerModal';
export type { IconPickerModalProps } from './IconPickerModal';
export { LazyIconPickerModal } from './LazyIconPickerModal';
