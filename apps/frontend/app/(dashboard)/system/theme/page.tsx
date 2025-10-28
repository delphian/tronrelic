'use client';

import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { useSystemAuth } from '../../../../features/system';
import {
    fetchThemes,
    createTheme,
    updateTheme,
    deleteTheme,
    toggleTheme,
    validateCSS,
    selectTheme,
    clearValidation,
    clearError,
    type ITheme
} from '../../../../features/system/themeSlice';

/**
 * Theme management page for administrators.
 *
 * Provides CRUD operations for custom CSS themes with dependency management,
 * validation, and activation controls. Uses SystemAuthContext for admin token
 * and Redux for state management.
 */
export default function ThemePage() {
    const dispatch = useAppDispatch();
    const { token } = useSystemAuth();
    const themes = useAppSelector((state) => state.theme.themes);
    const selectedTheme = useAppSelector((state) => state.theme.selectedTheme);
    const validationResult = useAppSelector((state) => state.theme.validationResult);
    const loading = useAppSelector((state) => state.theme.loading);
    const error = useAppSelector((state) => state.theme.error);

    const [formData, setFormData] = useState({
        name: '',
        css: '',
        dependencies: [] as string[],
        isActive: false
    });

    useEffect(() => {
        void dispatch(fetchThemes());
    }, [dispatch]);

    useEffect(() => {
        if (selectedTheme) {
            setFormData({
                name: selectedTheme.name,
                css: selectedTheme.css,
                dependencies: selectedTheme.dependencies,
                isActive: selectedTheme.isActive
            });
        }
    }, [selectedTheme]);

    const handleSelectTheme = (theme: ITheme | null) => {
        dispatch(selectTheme(theme));
        if (!theme) {
            setFormData({ name: '', css: '', dependencies: [], isActive: false });
        }
    };

    const handleSave = async () => {
        if (selectedTheme) {
            await dispatch(updateTheme({ id: selectedTheme.id, input: formData, token }));
        } else {
            await dispatch(createTheme({ ...formData, token }));
        }
        void dispatch(fetchThemes());
    };

    const handleValidate = async () => {
        if (selectedTheme) {
            await dispatch(validateCSS({ id: selectedTheme.id, css: formData.css, token }));
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this theme?')) {
            await dispatch(deleteTheme({ id, token }));
            void dispatch(fetchThemes());
        }
    };

    const handleToggle = async (id: string, isActive: boolean) => {
        await dispatch(toggleTheme({ id, isActive, token }));
        void dispatch(fetchThemes());
    };

    return (
        <div style={{ padding: '2rem' }}>
            <h1>Theme Management</h1>

            {error && (
                <div style={{ background: 'red', color: 'white', padding: '1rem', marginBottom: '1rem' }}>
                    {error}
                    <button onClick={() => dispatch(clearError())}>Clear</button>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
                {/* Left: Theme List */}
                <div>
                    <h2>Themes</h2>
                    <button onClick={() => handleSelectTheme(null)} disabled={loading}>
                        Create New Theme
                    </button>

                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {themes.map((theme) => (
                            <li
                                key={theme.id}
                                style={{
                                    padding: '0.5rem',
                                    margin: '0.5rem 0',
                                    border: selectedTheme?.id === theme.id ? '2px solid blue' : '1px solid gray',
                                    cursor: 'pointer'
                                }}
                            >
                                <div onClick={() => handleSelectTheme(theme)}>
                                    <strong>{theme.name}</strong>
                                    <div>
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={theme.isActive}
                                                onChange={(e) => void handleToggle(theme.id, e.target.checked)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            Active
                                        </label>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'gray' }}>
                                        Dependencies: {theme.dependencies.length}
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleDelete(theme.id);
                                    }}
                                    disabled={loading}
                                >
                                    Delete
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Right: Editor */}
                <div>
                    <h2>{selectedTheme ? 'Edit Theme' : 'Create Theme'}</h2>

                    <div style={{ marginBottom: '1rem' }}>
                        <label>
                            Name:
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </label>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                        <label>
                            CSS:
                            <textarea
                                value={formData.css}
                                onChange={(e) => setFormData({ ...formData, css: e.target.value })}
                                style={{ width: '100%', height: '300px', fontFamily: 'monospace', padding: '0.5rem' }}
                            />
                        </label>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                        <label>
                            Dependencies (select multiple):
                            <select
                                multiple
                                value={formData.dependencies}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        dependencies: Array.from(e.target.selectedOptions, (opt) => opt.value)
                                    })
                                }
                                style={{ width: '100%', height: '100px' }}
                            >
                                {themes
                                    .filter((t) => t.id !== selectedTheme?.id)
                                    .map((theme) => (
                                        <option key={theme.id} value={theme.id}>
                                            {theme.name}
                                        </option>
                                    ))}
                            </select>
                        </label>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                        <label>
                            <input
                                type="checkbox"
                                checked={formData.isActive}
                                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                            />
                            Active
                        </label>
                    </div>

                    {validationResult && (
                        <div
                            style={{
                                padding: '1rem',
                                marginBottom: '1rem',
                                background: validationResult.valid ? 'green' : 'orange',
                                color: 'white'
                            }}
                        >
                            {validationResult.valid ? (
                                <p>CSS is valid!</p>
                            ) : (
                                <div>
                                    <p>CSS errors:</p>
                                    <ul>
                                        {validationResult.errors.map((err, i) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <button onClick={() => dispatch(clearValidation())}>Clear</button>
                        </div>
                    )}

                    <div>
                        <button onClick={handleValidate} disabled={loading || !selectedTheme}>
                            Validate CSS
                        </button>
                        <button onClick={handleSave} disabled={loading || !formData.name || !formData.css}>
                            {loading ? 'Saving...' : 'Save'}
                        </button>
                        {selectedTheme && (
                            <button onClick={() => handleSelectTheme(null)}>Cancel</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
