import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MemoRecord } from '../../lib/api';

interface MemoState {
  memos: MemoRecord[];
}

const initialState: MemoState = {
  memos: []
};

const memoSlice = createSlice({
  name: 'memos',
  initialState,
  reducers: {
    setMemos(state, action: PayloadAction<MemoRecord[]>) {
      state.memos = action.payload;
    },
    prependMemo(state, action: PayloadAction<MemoRecord>) {
      const newMemo = action.payload;
      const identifier = newMemo.memoId ?? newMemo.txId;
      state.memos = [
        newMemo,
        ...state.memos.filter(existing => (existing.memoId ?? existing.txId) !== identifier)
      ].slice(0, 200);
    }
  }
});

export const { setMemos, prependMemo } = memoSlice.actions;
export default memoSlice.reducer;
