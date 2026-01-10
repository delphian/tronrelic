'use client';

import { useState, useMemo, type ComponentType } from 'react';
import * as LucideIcons from 'lucide-react';
import { Input } from '../Input';
import { Button } from '../Button';
import { Search, X } from 'lucide-react';
import styles from './IconPickerModal.module.css';

type LucideIconComponent = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

/**
 * Determine whether a lucide-react export represents a renderable icon component.
 *
 * Filters out helper utilities (like the base Icon component) that expect an
 * `iconNode` prop and will throw runtime errors when rendered without it.
 *
 * @param name - Export name from lucide-react to evaluate
 * @param candidate - Exported value associated with the provided name
 * @returns True when the export is a usable icon component
 */
const isRenderableLucideExport = (name: string, candidate: unknown): candidate is LucideIconComponent => {
    // Must start with uppercase
    if (!/^[A-Z]/.test(name)) {
        return false;
    }

    // Exclude utility exports
    if (name === 'createLucideIcon' || name === 'icons' || name === 'Icon') {
        return false;
    }

    // Exclude alias patterns to prevent duplicates:
    // - LucideSnowflake → duplicate of Snowflake
    // - SnowflakeIcon → duplicate of Snowflake
    if (name.startsWith('Lucide') || name.endsWith('Icon')) {
        return false;
    }

    if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
        return false;
    }

    const component = candidate as { displayName?: unknown };
    return typeof component.displayName === 'string';
};

/**
 * Icon Picker Modal Props
 *
 * Configuration for the icon picker modal component.
 */
export interface IconPickerModalProps {
    /** Currently selected icon name (e.g., 'Sparkles') */
    selectedIcon?: string;
    /** Callback invoked when user selects an icon */
    onSelect: (iconName: string) => void;
    /** Callback to close the modal */
    onClose: () => void;
}

/**
 * Icon Picker Modal Component
 *
 * Provides a searchable grid interface for selecting Lucide React icons.
 * Displays icon previews with names, supports filtering by name, and
 * handles selection with visual feedback for the currently selected icon.
 *
 * Why this exists:
 * - Text input for icon names is error-prone (users may misspell or not know available icons)
 * - Visual icon browser provides immediate feedback and discovery
 * - Search functionality enables quick filtering through hundreds of icons
 * - Responsive grid layout adapts to modal width with container queries
 *
 * @param props - Component props
 * @param props.selectedIcon - Currently selected icon name
 * @param props.onSelect - Callback invoked when an icon is selected
 * @param props.onClose - Callback to close the modal
 * @returns Icon picker modal content
 */

export function IconPickerModal({ selectedIcon, onSelect, onClose }: IconPickerModalProps) {
    const [searchQuery, setSearchQuery] = useState('');

    /**
     * Get all available Lucide React icon names.
     *
     * Filters out non-component exports (like 'createLucideIcon' utility function)
     * and returns only valid icon component names.
     */
    const iconNames = useMemo<string[]>(() => {
        try {
            if (!LucideIcons || typeof LucideIcons !== 'object') {
                console.error('LucideIcons not loaded correctly');
                return [];
            }
            return Object.entries(LucideIcons)
                .filter(([name, candidate]) => isRenderableLucideExport(name, candidate))
                .map(([name]) => name)
                .sort();
        } catch (error) {
            console.error('Error loading icon names:', error);
            return [];
        }
    }, []);

    /**
     * Filter icons based on search query.
     *
     * Performs case-insensitive substring matching to find icons
     * whose names contain the search query. Defaults to empty array
     * to prevent undefined access during initial render.
     */
    const filteredIcons = useMemo(() => {
        if (!Array.isArray(iconNames)) {
            console.error('iconNames is not an array:', iconNames);
            return [];
        }

        if (!searchQuery || !searchQuery.trim()) return iconNames;

        const query = searchQuery.toLowerCase();
        return iconNames.filter(name =>
            name.toLowerCase().includes(query)
        );
    }, [iconNames, searchQuery]) ?? [];

    /**
     * Handle icon selection and close modal.
     *
     * Invokes the onSelect callback with the chosen icon name,
     * then closes the modal immediately.
     *
     * @param iconName - Selected icon component name
     */
    const handleSelect = (iconName: string) => {
        onSelect(iconName);
        onClose();
    };

    return (
        <div className={styles.container}>
            {/* Search Input */}
            <div className={styles.search_container}>
                <Input
                    type="text"
                    placeholder="Search icons..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={styles.search_input}
                    aria-label="Search icons"
                />
                <Search className={styles.search_icon} size={16} />
            </div>

            {/* Results Count */}
            <p className={styles.results_count}>
                {filteredIcons?.length ?? 0} {(filteredIcons?.length ?? 0) === 1 ? 'icon' : 'icons'} found
            </p>

            {/* Icon Grid */}
            <div className={styles.icon_grid}>
                {Array.isArray(filteredIcons) && filteredIcons.map(iconName => {
                    const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as LucideIconComponent | undefined;

                    if (!IconComponent) {
                        console.warn(`Lucide icon "${iconName}" is not available in this bundle.`);
                        return null;
                    }

                    const isSelected = iconName === selectedIcon;

                    return (
                        <button
                            key={iconName}
                            type="button"
                            className={`${styles.icon_button} ${isSelected ? styles['icon_button--selected'] : ''}`}
                            onClick={() => handleSelect(iconName)}
                            aria-label={`Select ${iconName} icon`}
                            title={iconName}
                        >
                            <div className={styles.icon_preview}>
                                <IconComponent size={24} aria-hidden={true} />
                            </div>
                            <span className={styles.icon_name}>{iconName}</span>
                        </button>
                    );
                })}
            </div>

            {/* No Results Message */}
            {(filteredIcons?.length ?? 0) === 0 && (
                <div className={styles.empty_state}>
                    <p className={styles.empty_state_text}>No icons found matching "{searchQuery}"</p>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSearchQuery('')}
                    >
                        Clear search
                    </Button>
                </div>
            )}

            {/* Action Bar */}
            <div className={styles.action_bar}>
                <Button
                    variant="ghost"
                    size="md"
                    icon={<X />}
                    onClick={onClose}
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
}
