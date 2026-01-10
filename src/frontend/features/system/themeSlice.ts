import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Theme document interface matching backend IThemeDocument.
 */
export interface ITheme {
    _id: string;
    id: string;
    name: string;
    icon: string;
    css: string;
    dependencies: string[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

/**
 * CSS validation result from backend.
 */
export interface IValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Theme slice state.
 */
export interface IThemeState {
    themes: ITheme[];
    selectedTheme: ITheme | null;
    validationResult: IValidationResult | null;
    loading: boolean;
    error: string | null;
}

const initialState: IThemeState = {
    themes: [],
    selectedTheme: null,
    validationResult: null,
    loading: false,
    error: null
};

/**
 * Fetch all themes from backend.
 */
export const fetchThemes = createAsyncThunk(
    'theme/fetchThemes',
    async (_, { rejectWithValue }) => {
        try {
            const response = await fetch('/api/system/themes');
            if (!response.ok) {
                throw new Error('Failed to fetch themes');
            }
            const data = await response.json();
            return data.themes as ITheme[];
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
        }
    }
);

/**
 * Create a new theme.
 */
export const createTheme = createAsyncThunk(
    'theme/createTheme',
    async (input: { id?: string; name: string; icon: string; css: string; dependencies?: string[]; isActive?: boolean; token: string }, { rejectWithValue }) => {
        try {
            const { token, ...themeData } = input;

            const response = await fetch('/api/admin/system/themes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify(themeData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create theme');
            }

            const data = await response.json();
            return data.theme as ITheme;
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
        }
    }
);

/**
 * Update an existing theme.
 */
export const updateTheme = createAsyncThunk(
    'theme/updateTheme',
    async ({ id, input, token }: { id: string; input: Partial<ITheme>; token: string }, { rejectWithValue }) => {
        try {
            const response = await fetch(`/api/admin/system/themes/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify(input)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update theme');
            }

            const data = await response.json();
            return data.theme as ITheme;
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
        }
    }
);

/**
 * Delete a theme.
 */
export const deleteTheme = createAsyncThunk(
    'theme/deleteTheme',
    async ({ id, token }: { id: string; token: string }, { rejectWithValue }) => {
        try {
            const response = await fetch(`/api/admin/system/themes/${id}`, {
                method: 'DELETE',
                headers: {
                    'X-Admin-Token': token
                }
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete theme');
            }

            return id;
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
        }
    }
);

/**
 * Toggle theme active status.
 */
export const toggleTheme = createAsyncThunk(
    'theme/toggleTheme',
    async ({ id, isActive, token }: { id: string; isActive: boolean; token: string }, { rejectWithValue }) => {
        try {
            const response = await fetch(`/api/admin/system/themes/${id}/toggle`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify({ isActive })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to toggle theme');
            }

            const data = await response.json();
            return data.theme as ITheme;
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
        }
    }
);

/**
 * Validate CSS without saving.
 */
export const validateCSS = createAsyncThunk(
    'theme/validateCSS',
    async ({ id, css, token }: { id: string; css: string; token: string }, { rejectWithValue }) => {
        try {
            const response = await fetch(`/api/admin/system/themes/${id}/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify({ css })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to validate CSS');
            }

            return await response.json() as IValidationResult;
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
        }
    }
);

const themeSlice = createSlice({
    name: 'theme',
    initialState,
    reducers: {
        selectTheme: (state, action: PayloadAction<ITheme | null>) => {
            state.selectedTheme = action.payload;
            state.validationResult = null; // Clear validation when selecting new theme
        },
        clearValidation: (state) => {
            state.validationResult = null;
        },
        clearError: (state) => {
            state.error = null;
        }
    },
    extraReducers: (builder) => {
        // Fetch themes
        builder.addCase(fetchThemes.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(fetchThemes.fulfilled, (state, action) => {
            state.loading = false;
            state.themes = action.payload;
        });
        builder.addCase(fetchThemes.rejected, (state, action) => {
            state.loading = false;
            state.error = action.payload as string;
        });

        // Create theme
        builder.addCase(createTheme.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(createTheme.fulfilled, (state, action) => {
            state.loading = false;
            state.themes.push(action.payload);
            state.selectedTheme = action.payload;
        });
        builder.addCase(createTheme.rejected, (state, action) => {
            state.loading = false;
            state.error = action.payload as string;
        });

        // Update theme
        builder.addCase(updateTheme.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(updateTheme.fulfilled, (state, action) => {
            state.loading = false;
            const index = state.themes.findIndex(t => t.id === action.payload.id);
            if (index !== -1) {
                state.themes[index] = action.payload;
            }
            state.selectedTheme = action.payload;
        });
        builder.addCase(updateTheme.rejected, (state, action) => {
            state.loading = false;
            state.error = action.payload as string;
        });

        // Delete theme
        builder.addCase(deleteTheme.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(deleteTheme.fulfilled, (state, action) => {
            state.loading = false;
            state.themes = state.themes.filter(t => t.id !== action.payload);
            if (state.selectedTheme?.id === action.payload) {
                state.selectedTheme = null;
            }
        });
        builder.addCase(deleteTheme.rejected, (state, action) => {
            state.loading = false;
            state.error = action.payload as string;
        });

        // Toggle theme
        builder.addCase(toggleTheme.fulfilled, (state, action) => {
            const index = state.themes.findIndex(t => t.id === action.payload.id);
            if (index !== -1) {
                state.themes[index] = action.payload;
            }
            if (state.selectedTheme?.id === action.payload.id) {
                state.selectedTheme = action.payload;
            }
        });
        builder.addCase(toggleTheme.rejected, (state, action) => {
            state.error = action.payload as string;
        });

        // Validate CSS
        builder.addCase(validateCSS.pending, (state) => {
            state.validationResult = null;
        });
        builder.addCase(validateCSS.fulfilled, (state, action) => {
            state.validationResult = action.payload;
        });
        builder.addCase(validateCSS.rejected, (state, action) => {
            state.error = action.payload as string;
        });
    }
});

export const { selectTheme, clearValidation, clearError } = themeSlice.actions;
export default themeSlice.reducer;
