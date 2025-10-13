import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MarketDocument } from '@tronrelic/shared';

export interface MarketsState {
  markets: MarketDocument[];
  lastUpdated?: string;
}

const initialState: MarketsState = {
  markets: []
};

const marketsSlice = createSlice({
  name: 'markets',
  initialState,
  reducers: {
    setMarkets(state, action: PayloadAction<MarketDocument[]>) {
      state.markets = action.payload;
      state.lastUpdated = new Date().toISOString();
    },
    upsertMarket(state, action: PayloadAction<MarketDocument>) {
      const index = state.markets.findIndex((market: MarketDocument) => market.guid === action.payload.guid);
      if (index >= 0) {
        state.markets[index] = action.payload;
      } else {
        state.markets.push(action.payload);
      }
      state.lastUpdated = new Date().toISOString();
    }
  }
});

export const { setMarkets, upsertMarket } = marketsSlice.actions;
export default marketsSlice.reducer;
