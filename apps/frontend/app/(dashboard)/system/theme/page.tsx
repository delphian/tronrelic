'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
import { useModal } from '../../../../components/ui/ModalProvider';
import { LazyIconPickerModal } from '../../../../components/ui/IconPickerModal';
import { Plus, Trash2, X, CheckCircle, AlertTriangle, Copy, Loader2 } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import styles from './page.module.css';

/**
 * Represents a parsed CSS variable with its name and value.
 */
interface CSSVariable {
    name: string;
    value: string;
}

/**
 * Represents a section of CSS variables grouped by their section comment.
 */
interface CSSSection {
    title: string;
    variables: CSSVariable[];
}

/**
 * Fetches and parses CSS design token files to extract all CSS variables.
 *
 * Fetches primitives.css and semantic-tokens.css, parses them to extract
 * variable declarations organized by section comments. Returns a complete
 * list of all design tokens available for theming.
 *
 * @returns Promise resolving to array of CSS sections with their variables
 */
async function fetchCSSVariables(): Promise<CSSSection[]> {
    const files = ['/primitives.css', '/semantic-tokens.css'];
    const sections: CSSSection[] = [];

    for (const file of files) {
        try {
            const response = await fetch(file);
            if (!response.ok) {
                console.warn(`Failed to fetch ${file}: ${response.status}`);
                continue;
            }

            const css = await response.text();
            const parsed = parseCSSVariables(css);
            sections.push(...parsed);
        } catch (err) {
            console.warn(`Error fetching ${file}:`, err);
        }
    }

    return sections;
}

/**
 * Parses CSS text to extract variables organized by section comments.
 *
 * Recognizes section headers in the format:
 *   /* ======== SECTION NAME ======== *\/
 * And extracts variable declarations in the format:
 *   --variable-name: value;
 *
 * @param css - Raw CSS text to parse
 * @returns Array of sections with their variables
 */
function parseCSSVariables(css: string): CSSSection[] {
    const sections: CSSSection[] = [];
    let currentSection: CSSSection | null = null;

    // Split into lines for easier parsing
    const lines = css.split('\n');

    // Regex patterns
    const sectionHeaderPattern = /\/\*\s*=+\s*(.+?)\s*=+\s*\*\//;
    const variablePattern = /^\s*(--[\w-]+):\s*(.+?);?\s*$/;

    for (const line of lines) {
        // Check for section header
        const sectionMatch = line.match(sectionHeaderPattern);
        if (sectionMatch) {
            // Save previous section if it has variables
            if (currentSection && currentSection.variables.length > 0) {
                sections.push(currentSection);
            }
            currentSection = {
                title: sectionMatch[1].trim(),
                variables: []
            };
            continue;
        }

        // Check for variable declaration
        const varMatch = line.match(variablePattern);
        if (varMatch) {
            const variable: CSSVariable = {
                name: varMatch[1],
                value: varMatch[2].replace(/;$/, '').trim()
            };

            if (currentSection) {
                currentSection.variables.push(variable);
            } else {
                // Variables before any section header go into a default section
                if (sections.length === 0 || sections[sections.length - 1].title !== 'Foundation') {
                    sections.push({ title: 'Foundation', variables: [] });
                }
                sections[sections.length - 1].variables.push(variable);
            }
        }
    }

    // Don't forget the last section
    if (currentSection && currentSection.variables.length > 0) {
        sections.push(currentSection);
    }

    return sections;
}

/**
 * Generates a CSS theme template with all variables organized by section.
 *
 * Creates a complete CSS template wrapped in a data-theme selector containing
 * all design tokens from primitives.css and semantic-tokens.css, organized
 * by their original section comments.
 *
 * @param themeId - UUID for the theme selector
 * @param sections - Parsed CSS sections with variables
 * @returns Formatted CSS template string
 */
function generateThemeTemplate(themeId: string, sections: CSSSection[]): string {
    let template = `[data-theme="${themeId}"] {\n`;

    for (const section of sections) {
        // Add section header
        template += `\n    /* ${'='.repeat(60)}\n`;
        template += `     * ${section.title}\n`;
        template += `     * ${'='.repeat(60)} */\n\n`;

        // Add variables
        for (const variable of section.variables) {
            template += `    ${variable.name}: ${variable.value};\n`;
        }
    }

    template += `}\n`;
    return template;
}

/**
 * Generate RFC4122 v4 compliant UUID using Math.random fallback.
 *
 * This fallback is used only when crypto.randomUUID() is unavailable (older browsers).
 * The generated UUID follows the v4 specification with proper version and variant bits.
 *
 * @returns UUID v4 string in format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
function generateUUIDv4Fallback(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

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
    const { open: openModal, close: closeModal } = useModal();
    const themes = useAppSelector((state) => state.theme.themes);
    const selectedTheme = useAppSelector((state) => state.theme.selectedTheme);
    const validationResult = useAppSelector((state) => state.theme.validationResult);
    const loading = useAppSelector((state) => state.theme.loading);
    const error = useAppSelector((state) => state.theme.error);

    const [formData, setFormData] = useState({
        id: '',
        name: '',
        icon: '',
        css: '',
        dependencies: [] as string[],
        isActive: false
    });

    // Loading state for fetching CSS variables when creating new theme
    const [loadingTemplate, setLoadingTemplate] = useState(false);

    // Track pending new theme ID to prevent race conditions when user selects
    // another theme while CSS variables are being fetched
    const pendingNewThemeIdRef = useRef<string | null>(null);

    // Form fields are disabled until user clicks "New" or selects an existing theme
    const isFormDisabled = !selectedTheme && !formData.id;

    useEffect(() => {
        void dispatch(fetchThemes());
    }, [dispatch]);

    useEffect(() => {
        if (selectedTheme) {
            setFormData({
                id: selectedTheme.id,
                name: selectedTheme.name,
                icon: selectedTheme.icon,
                css: selectedTheme.css,
                dependencies: selectedTheme.dependencies,
                isActive: selectedTheme.isActive
            });
        }
    }, [selectedTheme]);

    /**
     * Handles theme selection or creation of a new theme.
     *
     * When selecting an existing theme, loads its data into the form.
     * When creating a new theme (theme is null), fetches all CSS variables
     * from primitives.css and semantic-tokens.css to generate a complete
     * template with all design tokens.
     *
     * @param theme - Theme to select, or null to create new theme
     */
    const handleSelectTheme = useCallback(async (theme: ITheme | null) => {
        dispatch(selectTheme(theme));
        dispatch(clearValidation());

        if (theme) {
            // Selecting existing theme - cancel any pending new theme creation
            pendingNewThemeIdRef.current = null;
            return;
        }

        // Generate new UUID for client-side creation with RFC4122 v4 compliant fallback
        const newThemeId = crypto.randomUUID?.() ?? generateUUIDv4Fallback();

        // Track this new theme ID to detect if user selects another theme while loading
        pendingNewThemeIdRef.current = newThemeId;

        // Show loading state while fetching CSS variables
        setLoadingTemplate(true);

        try {
            // Fetch and parse CSS files to get all variables
            const sections = await fetchCSSVariables();

            // Guard: if user selected another theme while fetching, abort
            if (pendingNewThemeIdRef.current !== newThemeId) {
                return;
            }

            // Generate template with all variables organized by section
            const cssTemplate = sections.length > 0
                ? generateThemeTemplate(newThemeId, sections)
                : `[data-theme="${newThemeId}"] {\n    /* Failed to load CSS variables - add your overrides here */\n    --color-primary: #4f8cff;\n}`;

            setFormData({
                id: newThemeId,
                name: 'New Theme',
                icon: '',
                css: cssTemplate,
                dependencies: [],
                isActive: false
            });
        } catch (err) {
            // Guard: if user selected another theme while fetching, abort
            if (pendingNewThemeIdRef.current !== newThemeId) {
                return;
            }

            console.error('Failed to fetch CSS variables:', err);
            // Fallback to minimal template
            setFormData({
                id: newThemeId,
                name: 'New Theme',
                icon: '',
                css: `[data-theme="${newThemeId}"] {\n    /* Failed to load CSS variables - add your overrides here */\n    --color-primary: #4f8cff;\n}`,
                dependencies: [],
                isActive: false
            });
        } finally {
            // Only clear loading if this is still the active new theme creation
            if (pendingNewThemeIdRef.current === newThemeId) {
                setLoadingTemplate(false);
            }
        }
    }, [dispatch]);

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

    /**
     * Copies the theme UUID to clipboard.
     *
     * Uses the navigator clipboard API with a fallback for older browsers.
     */
    const handleCopyUUID = async (uuid: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent selecting the theme
        try {
            await navigator.clipboard.writeText(uuid);
            // Could add a toast notification here if available
        } catch (err) {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = uuid;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    };

    /**
     * Opens the icon picker modal for selecting a Lucide icon.
     *
     * Displays a searchable grid of all available Lucide React icons,
     * allowing visual selection instead of requiring users to remember
     * exact icon names.
     */
    const handleOpenIconPicker = () => {
        const modalId = openModal({
            title: 'Select Icon',
            size: 'lg',
            content: (
                <LazyIconPickerModal
                    selectedIcon={formData.icon}
                    onSelect={(iconName) => {
                        setFormData(prev => ({ ...prev, icon: iconName }));
                        closeModal(modalId);
                    }}
                    onClose={() => closeModal(modalId)}
                />
            ),
            dismissible: true
        });
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
                            icon={loadingTemplate ? <Loader2 className={styles.spinner} /> : <Plus />}
                            onClick={() => void handleSelectTheme(null)}
                            disabled={loading || loadingTemplate}
                            loading={loadingTemplate}
                        >
                            {loadingTemplate ? 'Loading...' : 'New'}
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
                                    onClick={() => void handleSelectTheme(theme)}
                                >
                                    <div className={styles.theme_item_content}>
                                        <div className={styles.theme_item_header}>
                                            <div className={styles.theme_name_wrapper}>
                                                <h3 className={styles.theme_name}>{theme.name}</h3>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    icon={<Copy size={14} />}
                                                    onClick={(e) => void handleCopyUUID(theme.id, e)}
                                                    title={`Copy UUID: ${theme.id}`}
                                                    className={styles.copy_uuid_button}
                                                />
                                            </div>
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
                        {/* Name and Icon Row */}
                        <div className={styles.form_row}>
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
                                    disabled={isFormDisabled}
                                />
                            </div>

                            {/* Icon Field */}
                            <div className={styles.form_group}>
                                <label className={styles.form_label}>
                                    Icon
                                </label>
                                <div className={styles.icon_picker_wrapper}>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="md"
                                        onClick={handleOpenIconPicker}
                                        className={styles.icon_picker_button}
                                        disabled={isFormDisabled}
                                    >
                                        {formData.icon ? 'Change Icon' : 'Select Icon'}
                                    </Button>
                                    {formData.icon && (
                                        <div className={styles.selected_icon_preview}>
                                            {(() => {
                                                // Validate icon name before looking it up
                                                const isValidIconName =
                                                    formData.icon !== 'createLucideIcon' &&
                                                    formData.icon !== 'icons' &&
                                                    formData.icon !== 'Icon' &&
                                                    /^[A-Z]/.test(formData.icon);

                                                if (!isValidIconName) {
                                                    return <span className={styles.selected_icon_name}>{formData.icon}</span>;
                                                }

                                                const IconComponent = LucideIcons[formData.icon as keyof typeof LucideIcons] as React.ComponentType<{ size?: number }> | undefined;
                                                return IconComponent ? (
                                                    <>
                                                        <IconComponent size={20} />
                                                        <span className={styles.selected_icon_name}>{formData.icon}</span>
                                                    </>
                                                ) : (
                                                    <span className={styles.selected_icon_name}>{formData.icon}</span>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                                <p className={styles.form_hint}>
                                    Select a Lucide icon for this theme
                                </p>
                            </div>
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
                                disabled={isFormDisabled}
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
                                disabled={isFormDisabled}
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
                                    disabled={isFormDisabled}
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
                                disabled={loading || !selectedTheme || isFormDisabled}
                            >
                                Validate CSS
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleSave}
                                disabled={loading || !formData.name || !formData.icon || !formData.css || isFormDisabled}
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
