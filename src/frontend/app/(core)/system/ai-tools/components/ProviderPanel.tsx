'use client';

/**
 * @fileoverview Provider panel — lists the installed AI provider plugins that
 * have registered with core (`'ai-providers'`), which is active, and any
 * provider-hosted tools they report. Core-owned and provider-agnostic, so it
 * survives swapping `trp-ai-assistant` for a different provider plugin.
 */

import type { IAiProviderInfo } from '@/types';
import { Card } from '../../../../../components/ui/Card';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack } from '../../../../../components/layout';
import styles from '../page.module.scss';

/**
 * Render the provider panel.
 *
 * @param props.providers - Installed AI provider metadata.
 * @returns The panel card.
 */
export function ProviderPanel({ providers }: { providers: IAiProviderInfo[] }) {
    return (
        <Card padding="sm">
            <Stack gap="sm">
                <strong>AI Providers</strong>
                {providers.length === 0
                    ? <span className="text-muted" style={{ fontSize: 'var(--font-size-body-sm)' }}>No AI provider plugin is installed — tools register but cannot be invoked until one is enabled.</span>
                    : providers.map(provider => (
                        <div key={provider.id} className={styles.provider_row}>
                            <Badge tone={provider.active ? 'success' : 'neutral'}>{provider.active ? 'active' : 'inactive'}</Badge>
                            <span className={styles.tool_name}>{provider.label}</span>
                            <span className="text-subtle mono">{provider.id}</span>
                            {provider.models && provider.models.length > 0 && (
                                <span className="text-muted" style={{ fontSize: 'var(--font-size-body-sm)' }}>
                                    {provider.models.length} model{provider.models.length === 1 ? '' : 's'}
                                </span>
                            )}
                            {provider.hostedTools && provider.hostedTools.length > 0 && (
                                <span className={styles.badges}>
                                    {provider.hostedTools.map(tool => <Badge key={tool} tone="warning">{tool}</Badge>)}
                                </span>
                            )}
                        </div>
                    ))}
            </Stack>
        </Card>
    );
}
