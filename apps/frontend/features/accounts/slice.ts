import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type WalletStatus = 'idle' | 'checking' | 'connecting' | 'connected' | 'error';

interface WalletState {
  address: string | null;
  status: WalletStatus;
  error?: string | null;
  providerDetected: boolean;
}

const initialState: WalletState = {
  address: null,
  status: 'idle',
  error: null,
  providerDetected: false
};

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setWalletAddress(state, action: PayloadAction<string | null>) {
      state.address = action.payload;
    },
    setWalletStatus(state, action: PayloadAction<WalletStatus>) {
      state.status = action.payload;
      if (action.payload !== 'error') {
        state.error = null;
      }
    },
    setWalletError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      if (action.payload) {
        state.status = 'error';
      }
    },
    setProviderDetected(state, action: PayloadAction<boolean>) {
      state.providerDetected = action.payload;
    },
    resetWalletState() {
      return initialState;
    }
  }
});

export const { setWalletAddress, setWalletStatus, setWalletError, setProviderDetected, resetWalletState } = walletSlice.actions;
export default walletSlice.reducer;
