import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface UiModalMetadata {
  id: string;
  title?: string;
  size: ModalSize;
  dismissible: boolean;
  openedAt: string;
}

export interface UiLoadingState {
  counters: Record<string, number>;
  isBusy: boolean;
  lastUpdated?: string;
}

export interface UiState {
  modals: UiModalMetadata[];
  loading: UiLoadingState;
}

const GLOBAL_KEY = '__global__';

type ModalOpenedPayload = Omit<UiModalMetadata, 'openedAt'> & { openedAt?: string };
type LoadingKeyPayload = { key?: string } | undefined;

const createInitialState = (): UiState => ({
  modals: [],
  loading: {
    counters: {},
    isBusy: false,
    lastUpdated: undefined
  }
});

const initialState = createInitialState();

function updateLoadingState(state: UiLoadingState, key: string, delta: number) {
  const current = state.counters[key] ?? 0;
  const next = current + delta;

  if (next <= 0) {
    delete state.counters[key];
  } else {
    state.counters[key] = next;
  }

  state.isBusy = Object.keys(state.counters).length > 0;
  state.lastUpdated = new Date().toISOString();
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    modalOpened(state, action: PayloadAction<ModalOpenedPayload>) {
      const { openedAt, ...rest } = action.payload;
      const metadata: UiModalMetadata = {
        ...rest,
        openedAt: openedAt ?? new Date().toISOString()
      };
      state.modals = [metadata, ...state.modals.filter(modal => modal.id !== metadata.id)];
    },
    modalClosed(state, action: PayloadAction<string>) {
      state.modals = state.modals.filter(modal => modal.id !== action.payload);
    },
    allModalsClosed(state) {
      state.modals = [];
    },
    startLoading(state, action: PayloadAction<LoadingKeyPayload>) {
      const key = action.payload?.key ?? GLOBAL_KEY;
      updateLoadingState(state.loading, key, 1);
    },
    stopLoading(state, action: PayloadAction<LoadingKeyPayload>) {
      const key = action.payload?.key ?? GLOBAL_KEY;
      updateLoadingState(state.loading, key, -1);
    },
    resetLoading(state) {
      state.loading = {
        counters: {},
        isBusy: false,
        lastUpdated: new Date().toISOString()
      };
    },
    resetUi: () => createInitialState()
  }
});

export const {
  modalOpened,
  modalClosed,
  allModalsClosed,
  startLoading,
  stopLoading,
  resetLoading,
  resetUi
} = uiSlice.actions;

export default uiSlice.reducer;
