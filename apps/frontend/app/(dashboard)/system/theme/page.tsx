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
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Badge } from '../../../../components/ui/Badge';
import { Plus, Trash2, X, CheckCircle, AlertTriangle } from 'lucide-react';
import styles from './page.module.css';

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
        dispatch(clearValidation());
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
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <h1 className={styles.title}>Theme Management</h1>
                <p className={styles.subtitle}>Create and manage custom CSS themes with dependency resolution</p>
            </div>

            {/* Error Alert */}
            {error && (
                <div className={styles.error}>
                    <p className={styles.error_message}>{error}</p>
                    <Button variant="ghost" size="sm" icon={<X />} onClick={() => dispatch(clearError())}>
                        Dismiss
                    </Button>
                </div>
            )}

            <div className={styles.content}>
                {/* Left Panel: Theme List */}
                <Card className={styles.theme_list_panel}>
                    <div className={styles.panel_header}>
                        <h2 className={styles.panel_title}>Themes</h2>
                        <Button
                            variant="primary"
                            size="sm"
                            icon={<Plus />}
                            onClick={() => handleSelectTheme(null)}
                            disabled={loading}
                        >
                            New
                        </Button>
                    </div>

                    {themes.length === 0 ? (
                        <div className={styles.empty_state}>
                            <p className={styles.empty_state_text}>No themes created yet</p>
                        </div>
                    ) : (
                        <ul className={styles.theme_list}>
                            {themes.map((theme) => (
                                <li
                                    key={theme.id}
                                    className={`${styles.theme_item} ${
                                        selectedTheme?.id === theme.id ? styles['theme_item--selected'] : ''
                                    }`}
                                >
                                    <div
                                        className={styles.theme_item_content}
                                        onClick={() => handleSelectTheme(theme)}
                                    >
                                        <div className={styles.theme_item_header}>
                                            <h3 className={styles.theme_name}>{theme.name}</h3>
                                            {theme.isActive && <Badge tone="success">Active</Badge>}
                                        </div>

                                        <label
                                            className={styles.theme_toggle}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={theme.isActive}
                                                onChange={(e) => void handleToggle(theme.id, e.target.checked)}
                                            />
                                            <span>Enable theme</span>
                                        </label>

                                        <p className={styles.theme_meta}>
                                            Dependencies: {theme.dependencies.length}
                                        </p>
                                    </div>

                                    <div className={styles.theme_actions}>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            icon={<Trash2 />}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void handleDelete(theme.id);
                                            }}
                                            disabled={loading}
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                {/* Right Panel: Editor */}
                <Card className={styles.editor_panel}>
                    <div className={styles.editor_header}>
                        <h2 className={styles.editor_title}>
                            {selectedTheme ? 'Edit Theme' : 'Create Theme'}
                        </h2>
                    </div>

                    <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
                        {/* Name Field */}
                        <div className={styles.form_group}>
                            <label htmlFor="theme-name" className={styles.form_label}>
                                Theme Name
                            </label>
                            <Input
                                id="theme-name"
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Enter theme name"
                            />
                        </div>

                        {/* CSS Field */}
                        <div className={styles.form_group}>
                            <label htmlFor="theme-css" className={styles.form_label}>
                                CSS Code
                            </label>
                            <p className={styles.form_hint}>
                                Write custom CSS rules to override design tokens and component styles
                            </p>
                            <textarea
                                id="theme-css"
                                className={styles.css_textarea}
                                value={formData.css}
                                onChange={(e) => setFormData({ ...formData, css: e.target.value })}
                                placeholder="/* Enter CSS rules here */"
                            />
                        </div>

                        {/* Dependencies Field */}
                        <div className={styles.form_group}>
                            <label htmlFor="theme-deps" className={styles.form_label}>
                                Dependencies
                            </label>
                            <p className={styles.form_hint}>
                                Select themes that must load before this theme (Ctrl+Click for multiple)
                            </p>
                            <select
                                id="theme-deps"
                                className={styles.dependencies_select}
                                multiple
                                value={formData.dependencies}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        dependencies: Array.from(e.target.selectedOptions, (opt) => opt.value)
                                    })
                                }
                            >
                                {themes
                                    .filter((t) => t.id !== selectedTheme?.id)
                                    .map((theme) => (
                                        <option key={theme.id} value={theme.id}>
                                            {theme.name}
                                        </option>
                                    ))}
                            </select>
                        </div>

                        {/* Active Checkbox */}
                        <div className={styles.form_group}>
                            <label className={styles.checkbox_group}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                />
                                <span className={styles.checkbox_label}>Enable theme immediately after save</span>
                            </label>
                        </div>

                        {/* Validation Result */}
                        {validationResult && (
                            <div
                                className={`${styles.validation_result} ${
                                    validationResult.valid
                                        ? styles['validation_result--success']
                                        : styles['validation_result--error']
                                }`}
                            >
                                <div className={styles.validation_header}>
                                    <p className={styles.validation_message}>
                                        {validationResult.valid ? (
                                            <>
                                                <CheckCircle style={{ display: 'inline', marginRight: '0.5rem' }} />
                                                CSS is valid!
                                            </>
                                        ) : (
                                            <>
                                                <AlertTriangle style={{ display: 'inline', marginRight: '0.5rem' }} />
                                                CSS validation errors:
                                            </>
                                        )}
                                    </p>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<X />}
                                        onClick={() => dispatch(clearValidation())}
                                    >
                                        Clear
                                    </Button>
                                </div>
                                {!validationResult.valid && (
                                    <ul className={styles.validation_errors}>
                                        {validationResult.errors.map((err, i) => (
                                            <li key={i} className={styles.validation_error_item}>
                                                {err}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}

                        {/* Actions */}
                        <div className={styles.form_actions}>
                            <Button
                                variant="secondary"
                                onClick={handleValidate}
                                disabled={loading || !selectedTheme}
                            >
                                Validate CSS
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleSave}
                                disabled={loading || !formData.name || !formData.css}
                                loading={loading}
                            >
                                Save Theme
                            </Button>
                            {selectedTheme && (
                                <Button variant="ghost" onClick={() => handleSelectTheme(null)}>
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </form>
                </Card>
            </div>
        </div>
    );
}
