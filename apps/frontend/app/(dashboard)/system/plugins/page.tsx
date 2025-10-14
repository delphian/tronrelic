'use client';

import { useEffect, useState } from 'react';
import type { IPluginInfo } from '@tronrelic/types';

interface PluginCardProps {
    pluginInfo: IPluginInfo;
    onInstall: (pluginId: string) => void;
    onUninstall: (pluginId: string) => void;
    onEnable: (pluginId: string) => void;
    onDisable: (pluginId: string) => void;
    isLoading: boolean;
}

function PluginCard({ pluginInfo, onInstall, onUninstall, onEnable, onDisable, isLoading }: PluginCardProps) {
    const { manifest, metadata } = pluginInfo;
    const [showConfirm, setShowConfirm] = useState<'install' | 'uninstall' | 'enable' | 'disable' | null>(null);

    const handleInstall = () => {
        if (showConfirm === 'install') {
            onInstall(manifest.id);
            setShowConfirm(null);
        } else {
            setShowConfirm('install');
        }
    };

    const handleUninstall = () => {
        if (showConfirm === 'uninstall') {
            onUninstall(manifest.id);
            setShowConfirm(null);
        } else {
            setShowConfirm('uninstall');
        }
    };

    const handleEnable = () => {
        if (showConfirm === 'enable') {
            onEnable(manifest.id);
            setShowConfirm(null);
        } else {
            setShowConfirm('enable');
        }
    };

    const handleDisable = () => {
        if (showConfirm === 'disable') {
            onDisable(manifest.id);
            setShowConfirm(null);
        } else {
            setShowConfirm('disable');
        }
    };

    const canInstall = !metadata.installed;
    const canUninstall = metadata.installed;
    const canEnable = metadata.installed && !metadata.enabled;
    const canDisable = metadata.enabled;

    return (
        <div style={{
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            padding: '1.5rem',
            background: 'rgba(255,255,255,0.02)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{manifest.title}</h3>
                    <p style={{ opacity: 0.6, fontSize: '0.875rem', marginTop: '0.25rem' }}>
                        {manifest.id} • v{manifest.version}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        background: metadata.installed ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)',
                        color: metadata.installed ? '#22c55e' : '#9ca3af'
                    }}>
                        {metadata.installed ? 'Installed' : 'Not Installed'}
                    </span>
                    <span style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        background: metadata.enabled ? 'rgba(59, 130, 246, 0.2)' : 'rgba(156, 163, 175, 0.2)',
                        color: metadata.enabled ? '#3b82f6' : '#9ca3af'
                    }}>
                        {metadata.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                </div>
            </div>

            {manifest.description && (
                <p style={{ opacity: 0.7, marginBottom: '1rem', fontSize: '0.875rem' }}>
                    {manifest.description}
                </p>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem', opacity: 0.6, marginBottom: '1rem' }}>
                {manifest.author && (
                    <div>
                        <strong>Author:</strong> {manifest.author}
                    </div>
                )}
                {manifest.license && (
                    <div>
                        <strong>License:</strong> {manifest.license}
                    </div>
                )}
                <div>
                    <strong>Backend:</strong> {manifest.backend ? 'Yes' : 'No'}
                </div>
                <div>
                    <strong>Frontend:</strong> {manifest.frontend ? 'Yes' : 'No'}
                </div>
            </div>

            {metadata.lastError && (
                <div style={{
                    padding: '0.75rem',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '4px',
                    marginBottom: '1rem',
                    fontSize: '0.875rem'
                }}>
                    <strong style={{ color: '#ef4444' }}>Error:</strong>
                    <p style={{ marginTop: '0.25rem', opacity: 0.9 }}>{metadata.lastError}</p>
                    {metadata.lastErrorAt && (
                        <p style={{ marginTop: '0.25rem', opacity: 0.6, fontSize: '0.75rem' }}>
                            {new Date(metadata.lastErrorAt).toLocaleString()}
                        </p>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {showConfirm ? (
                    <>
                        <button
                            onClick={() => {
                                if (showConfirm === 'install') handleInstall();
                                if (showConfirm === 'uninstall') handleUninstall();
                                if (showConfirm === 'enable') handleEnable();
                                if (showConfirm === 'disable') handleDisable();
                            }}
                            disabled={isLoading}
                            style={{
                                padding: '0.5rem 1rem',
                                background: '#ef4444',
                                border: '1px solid #dc2626',
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                opacity: isLoading ? 0.5 : 1
                            }}
                        >
                            Confirm {showConfirm}
                        </button>
                        <button
                            onClick={() => setShowConfirm(null)}
                            disabled={isLoading}
                            style={{
                                padding: '0.5rem 1rem',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                opacity: isLoading ? 0.5 : 1
                            }}
                        >
                            Cancel
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={handleInstall}
                            disabled={!canInstall || isLoading}
                            style={{
                                padding: '0.5rem 1rem',
                                background: canInstall ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.1)',
                                border: `1px solid ${canInstall ? '#22c55e' : 'rgba(156, 163, 175, 0.2)'}`,
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                cursor: canInstall && !isLoading ? 'pointer' : 'not-allowed',
                                opacity: canInstall && !isLoading ? 1 : 0.5,
                                color: canInstall ? '#22c55e' : '#9ca3af'
                            }}
                        >
                            Install
                        </button>
                        <button
                            onClick={handleUninstall}
                            disabled={!canUninstall || isLoading}
                            style={{
                                padding: '0.5rem 1rem',
                                background: canUninstall ? 'rgba(239, 68, 68, 0.2)' : 'rgba(156, 163, 175, 0.1)',
                                border: `1px solid ${canUninstall ? '#ef4444' : 'rgba(156, 163, 175, 0.2)'}`,
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                cursor: canUninstall && !isLoading ? 'pointer' : 'not-allowed',
                                opacity: canUninstall && !isLoading ? 1 : 0.5,
                                color: canUninstall ? '#ef4444' : '#9ca3af'
                            }}
                        >
                            Uninstall
                        </button>
                        <button
                            onClick={handleEnable}
                            disabled={!canEnable || isLoading}
                            style={{
                                padding: '0.5rem 1rem',
                                background: canEnable ? 'rgba(59, 130, 246, 0.2)' : 'rgba(156, 163, 175, 0.1)',
                                border: `1px solid ${canEnable ? '#3b82f6' : 'rgba(156, 163, 175, 0.2)'}`,
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                cursor: canEnable && !isLoading ? 'pointer' : 'not-allowed',
                                opacity: canEnable && !isLoading ? 1 : 0.5,
                                color: canEnable ? '#3b82f6' : '#9ca3af'
                            }}
                        >
                            Enable
                        </button>
                        <button
                            onClick={handleDisable}
                            disabled={!canDisable || isLoading}
                            style={{
                                padding: '0.5rem 1rem',
                                background: canDisable ? 'rgba(249, 115, 22, 0.2)' : 'rgba(156, 163, 175, 0.1)',
                                border: `1px solid ${canDisable ? '#f97316' : 'rgba(156, 163, 175, 0.2)'}`,
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                cursor: canDisable && !isLoading ? 'pointer' : 'not-allowed',
                                opacity: canDisable && !isLoading ? 1 : 0.5,
                                color: canDisable ? '#f97316' : '#9ca3af'
                            }}
                        >
                            Disable
                        </button>
                        {manifest.adminUrl && (
                            <a
                                href={manifest.adminUrl}
                                style={{
                                    padding: '0.5rem 1rem',
                                    background: 'rgba(139, 92, 246, 0.2)',
                                    border: '1px solid #8b5cf6',
                                    borderRadius: '4px',
                                    fontSize: '0.875rem',
                                    fontWeight: 500,
                                    color: '#8b5cf6',
                                    textDecoration: 'none',
                                    display: 'inline-block'
                                }}
                            >
                                Settings
                            </a>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default function PluginsManagementPage() {
    const [token, setToken] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [plugins, setPlugins] = useState<IPluginInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        const savedToken = localStorage.getItem('admin_token');
        if (savedToken) {
            setToken(savedToken);
            setIsAuthenticated(true);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated) {
            fetchPlugins();
        }
    }, [isAuthenticated]);

    const fetchPlugins = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/plugin-management/all`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch plugins');
            }

            const data = await response.json();
            setPlugins(data.plugins || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch plugins');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePluginAction = async (action: 'install' | 'uninstall' | 'enable' | 'disable', pluginId: string) => {
        try {
            setIsLoading(true);
            setError(null);
            setSuccessMessage(null);

            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/plugin-management/${pluginId}/${action}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Failed to ${action} plugin`);
            }

            setSuccessMessage(data.message || `Plugin ${action}ed successfully`);

            // Refresh plugins list
            await fetchPlugins();

            // Clear success message after 3 seconds
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to ${action} plugin`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (token.trim()) {
            localStorage.setItem('admin_token', token);
            setIsAuthenticated(true);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        setToken('');
        setIsAuthenticated(false);
    };

    if (!isAuthenticated) {
        return (
            <div className="page" style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem' }}>
                <div style={{ display: 'grid', gap: '1.5rem' }}>
                    <header>
                        <h1>Plugin Management</h1>
                        <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>
                            Enter your admin token to manage plugins
                        </p>
                    </header>
                    <form onSubmit={handleLogin} style={{ display: 'grid', gap: '1rem' }}>
                        <label style={{ display: 'grid', gap: '0.5rem' }}>
                            <span>Admin Token</span>
                            <input
                                type="password"
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                placeholder="Enter admin API token"
                                style={{ padding: '0.75rem', fontSize: '1rem' }}
                                required
                            />
                        </label>
                        <button type="submit" style={{ padding: '0.75rem', fontSize: '1rem' }}>
                            Access Plugin Management
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="page" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'grid', gap: '2rem' }}>
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1>Plugin Management</h1>
                        <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>
                            Manage plugin installation and activation status
                        </p>
                    </div>
                    <button onClick={handleLogout} style={{ padding: '0.5rem 1rem' }}>
                        Logout
                    </button>
                </header>

                {error && (
                    <div style={{
                        padding: '1rem',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '4px',
                        color: '#ef4444'
                    }}>
                        {error}
                    </div>
                )}

                {successMessage && (
                    <div style={{
                        padding: '1rem',
                        background: 'rgba(34, 197, 94, 0.1)',
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        borderRadius: '4px',
                        color: '#22c55e'
                    }}>
                        {successMessage}
                    </div>
                )}

                <div style={{
                    display: 'flex',
                    gap: '1rem',
                    padding: '1rem',
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)'
                }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.875rem', opacity: 0.6 }}>Total Plugins</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600 }}>{plugins.length}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.875rem', opacity: 0.6 }}>Installed</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: '#22c55e' }}>
                            {plugins.filter(p => p.metadata.installed).length}
                        </div>
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.875rem', opacity: 0.6 }}>Enabled</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: '#3b82f6' }}>
                            {plugins.filter(p => p.metadata.enabled).length}
                        </div>
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.875rem', opacity: 0.6 }}>Errors</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: '#ef4444' }}>
                            {plugins.filter(p => p.metadata.lastError).length}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                    {plugins.map(pluginInfo => (
                        <PluginCard
                            key={pluginInfo.manifest.id}
                            pluginInfo={pluginInfo}
                            onInstall={(id) => handlePluginAction('install', id)}
                            onUninstall={(id) => handlePluginAction('uninstall', id)}
                            onEnable={(id) => handlePluginAction('enable', id)}
                            onDisable={(id) => handlePluginAction('disable', id)}
                            isLoading={isLoading}
                        />
                    ))}
                </div>

                {plugins.length === 0 && !isLoading && (
                    <div style={{
                        padding: '3rem',
                        textAlign: 'center',
                        opacity: 0.6,
                        border: '1px dashed rgba(255,255,255,0.1)',
                        borderRadius: '8px'
                    }}>
                        No plugins found
                    </div>
                )}
            </div>
        </div>
    );
}
