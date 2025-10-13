import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { BookmarkRecord } from '../../lib/api';

interface BookmarkState {
  items: BookmarkRecord[];
  status: 'idle' | 'loading' | 'error';
  error?: string | null;
}

const initialState: BookmarkState = {
  items: [],
  status: 'idle',
  error: null
};

const bookmarkSlice = createSlice({
  name: 'bookmarks',
  initialState,
  reducers: {
    setBookmarks(state, action: PayloadAction<BookmarkRecord[]>) {
      state.items = action.payload;
      state.status = 'idle';
      state.error = null;
    },
    setBookmarkStatus(state, action: PayloadAction<BookmarkState['status']>) {
      state.status = action.payload;
      if (action.payload !== 'error') {
        state.error = null;
      }
    },
    setBookmarkError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      state.status = 'error';
    },
    clearBookmarks(state) {
      state.items = [];
      state.status = 'idle';
      state.error = null;
    }
  }
});

export const { setBookmarks, setBookmarkStatus, setBookmarkError, clearBookmarks } = bookmarkSlice.actions;
export default bookmarkSlice.reducer;
