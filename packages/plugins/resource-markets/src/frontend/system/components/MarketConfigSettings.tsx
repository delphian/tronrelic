'use client';

import type { IFrontendPluginContext } from '@tronrelic/types';
import type { IResourceMarketsConfig } from '../../../shared/types';

interface MarketConfigSettingsProps {
    config: IResourceMarketsConfig;
    onChange: (config: IResourceMarketsConfig) => void;
    context: IFrontendPluginContext;
}

/**
 * Market Configuration Settings Component.
 *
 * Provides form controls for configuring the resource-markets plugin's
 * public page URL and navigation menu settings.
 *
 * **Configurable Settings:**
 * - Public page URL path (must start with `/plugins/resource-markets/`)
 * - Menu item label
 * - Menu item icon (lucide-react icon name)
 * - Menu item display order
 *
 * @param props - Component props
 * @param props.config - Current configuration state
 * @param props.onChange - Configuration update callback
 * @param props.context - Frontend plugin context for UI components
 */
export function MarketConfigSettings({ config, onChange, context }: MarketConfigSettingsProps) {
    const { ui } = context;

    const handleUrlChange = (value: string) => {
        onChange({ ...config, publicPageUrl: value });
    };

    const handleLabelChange = (value: string) => {
        onChange({ ...config, menuLabel: value });
    };

    const handleIconChange = (value: string) => {
        onChange({ ...config, menuIcon: value });
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

    return (
        <ui.Card>
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Page and Menu Configuration</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Public Page URL */}
                <div>
                    <label
                        htmlFor="publicPageUrl"
                        style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem' }}
                    >
                        Public Page URL
                    </label>
                    <input
                        id="publicPageUrl"
                        type="text"
                        value={config.publicPageUrl}
                        onChange={(e) => handleUrlChange(e.target.value)}
                        placeholder="/plugins/resource-markets/markets"
                        style={{
                            width: '100%',
                            padding: '0.5rem',
                            fontSize: '0.95rem',
                            border: isValidUrl(config.publicPageUrl) ? '1px solid var(--color-border)' : '1px solid var(--color-error)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--color-bg)',
                            color: 'var(--color-text)'
                        }}
                    />
                    {!isValidUrl(config.publicPageUrl) && (
                        <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: 'var(--color-error)' }}>
                            URL must start with /plugins/resource-markets/
                        </p>
                    )}
                    <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', opacity: 0.7 }}>
                        The URL where the public markets comparison page will be accessible
                    </p>
                </div>

                {/* Menu Label */}
                <div>
                    <label
                        htmlFor="menuLabel"
                        style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem' }}
                    >
                        Menu Label
                    </label>
                    <input
                        id="menuLabel"
                        type="text"
                        value={config.menuLabel}
                        onChange={(e) => handleLabelChange(e.target.value)}
                        placeholder="Energy Markets"
                        style={{
                            width: '100%',
                            padding: '0.5rem',
                            fontSize: '0.95rem',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--color-bg)',
                            color: 'var(--color-text)'
                        }}
                    />
                    <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', opacity: 0.7 }}>
                        Text displayed in the navigation menu
                    </p>
                </div>

                {/* Menu Icon */}
                <div>
                    <label
                        htmlFor="menuIcon"
                        style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem' }}
                    >
                        Menu Icon
                    </label>
                    <input
                        id="menuIcon"
                        type="text"
                        value={config.menuIcon}
                        onChange={(e) => handleIconChange(e.target.value)}
                        placeholder="TrendingUp"
                        style={{
                            width: '100%',
                            padding: '0.5rem',
                            fontSize: '0.95rem',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--color-bg)',
                            color: 'var(--color-text)'
                        }}
                    />
                    <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', opacity: 0.7 }}>
                        lucide-react icon name (e.g., TrendingUp, BarChart3, Activity)
                    </p>
                </div>

                {/* Menu Order */}
                <div>
                    <label
                        htmlFor="menuOrder"
                        style={{ display: 'block', fontWeight: 500, marginBottom: '0.5rem' }}
                    >
                        Menu Order
                    </label>
                    <input
                        id="menuOrder"
                        type="number"
                        value={config.menuOrder}
                        onChange={(e) => handleOrderChange(e.target.value)}
                        min="0"
                        max="9999"
                        style={{
                            width: '200px',
                            padding: '0.5rem',
                            fontSize: '0.95rem',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--color-bg)',
                            color: 'var(--color-text)'
                        }}
                    />
                    <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', opacity: 0.7 }}>
                        Display order in navigation menu (lower numbers appear first)
                    </p>
                </div>
            </div>
        </ui.Card>
    );
}
