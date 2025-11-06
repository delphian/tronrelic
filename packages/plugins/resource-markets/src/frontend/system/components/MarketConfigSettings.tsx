'use client';

import type { IFrontendPluginContext } from '@tronrelic/types';
import type { IResourceMarketsConfig } from '../../../shared/types';
import styles from './MarketConfigSettings.module.css';

interface MarketConfigSettingsProps {
    config: IResourceMarketsConfig;
    onChange: (config: IResourceMarketsConfig) => void;
    context: IFrontendPluginContext;
}

/**
 * Market Configuration Settings Component.
 *
 * Provides form controls for configuring the resource-markets plugin's
 * public page URL and navigation menu settings. Fields are displayed in
 * a responsive two-column layout on tablet/desktop (≥768px) and single
 * column on mobile devices.
 *
 * **Configurable Settings:**
 * - Public page URL path (must start with `/plugins/resource-markets/`)
 * - Menu item label
 * - Menu item icon (visual selection via IconPickerModal)
 * - Menu item display order
 *
 * **Responsive Layout:**
 * - Mobile (<768px): Single column, all fields stacked
 * - Tablet/Desktop (≥768px): Two columns with balanced distribution
 *   - Left: Public Page URL, Menu Icon
 *   - Right: Menu Label, Menu Order
 *
 * **Icon Selection:**
 * Uses IconPickerModal for visual icon discovery and selection. The modal
 * provides searchable icon grid, real-time preview, and guaranteed valid
 * icon names from lucide-react. The button displays the selected icon name
 * without a redundant preview (the modal already handles all icon rendering).
 *
 * @param props - Component props
 * @param props.config - Current configuration state
 * @param props.onChange - Configuration update callback
 * @param props.context - Frontend plugin context for UI components
 */
export function MarketConfigSettings({ config, onChange, context }: MarketConfigSettingsProps) {
    const { ui, useModal } = context;
    const { open: openModal, close: closeModal } = useModal();

    const handleUrlChange = (value: string) => {
        onChange({ ...config, publicPageUrl: value });
    };

    const handleLabelChange = (value: string) => {
        onChange({ ...config, menuLabel: value });
    };

    const handleIconChange = (iconName: string) => {
        onChange({ ...config, menuIcon: iconName });
    };

    const handleOrderChange = (value: string) => {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue)) {
            onChange({ ...config, menuOrder: numValue });
        }
    };

    const isValidUrl = (url: string): boolean => {
        return url.startsWith('/plugins/resource-markets/') && url.length > 26;
    };

    /**
     * Opens the icon picker modal for visual icon selection.
     *
     * Creates a modal instance with IconPickerModal content, pre-selecting
     * the current icon if one is configured. When user selects an icon,
     * updates the config state and closes the modal automatically.
     */
    const handleOpenIconPicker = () => {
        const modalId = openModal({
            title: 'Select Menu Icon',
            size: 'lg',
            content: (
                <ui.IconPickerModal
                    selectedIcon={config.menuIcon}
                    onSelect={(iconName) => {
                        handleIconChange(iconName);
                    }}
                    onClose={() => closeModal(modalId)}
                />
            ),
            dismissible: true
        });
    };

    return (
        <div className={styles.container}>
            <ui.Card>
                <h2 style={{ marginTop: 0, marginBottom: 'var(--spacing-10)' }}>Page and Menu Configuration</h2>

                <div className={styles.form}>
                    <div className={styles.column}>
                        <div className={styles.field}>
                            <label htmlFor="publicPageUrl" className={styles.label}>
                                Public Page URL
                            </label>
                            <input
                                id="publicPageUrl"
                                type="text"
                                value={config.publicPageUrl}
                                onChange={(e) => handleUrlChange(e.target.value)}
                                placeholder="/plugins/resource-markets/markets"
                                className={`${styles.input} ${!isValidUrl(config.publicPageUrl) ? styles['input--error'] : ''}`}
                            />
                            {!isValidUrl(config.publicPageUrl) && (
                                <p className={styles.error_text}>
                                    URL must start with /plugins/resource-markets/
                                </p>
                            )}
                            <p className={styles.help_text}>
                                The URL where the public markets comparison page will be accessible
                            </p>
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="menuIcon" className={styles.label}>
                                Menu Icon
                            </label>
                            <ui.Button
                                onClick={handleOpenIconPicker}
                                variant="secondary"
                                size="md"
                            >
                                {config.menuIcon ? `Change Icon: ${config.menuIcon}` : 'Choose Icon'}
                            </ui.Button>
                            <p className={styles.help_text}>
                                Click to browse and select from available Lucide React icons
                            </p>
                        </div>
                    </div>

                    <div className={styles.column}>
                        <div className={styles.field}>
                            <label htmlFor="menuLabel" className={styles.label}>
                                Menu Label
                            </label>
                            <input
                                id="menuLabel"
                                type="text"
                                value={config.menuLabel}
                                onChange={(e) => handleLabelChange(e.target.value)}
                                placeholder="Energy Markets"
                                className={styles.input}
                            />
                            <p className={styles.help_text}>
                                Text displayed in the navigation menu
                            </p>
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="menuOrder" className={styles.label}>
                                Menu Order
                            </label>
                            <input
                                id="menuOrder"
                                type="number"
                                value={config.menuOrder}
                                onChange={(e) => handleOrderChange(e.target.value)}
                                min="0"
                                max="9999"
                                className={`${styles.input} ${styles['input--number']}`}
                            />
                            <p className={styles.help_text}>
                                Display order in navigation menu (lower numbers appear first)
                            </p>
                        </div>
                    </div>
                </div>
            </ui.Card>
        </div>
    );
}
