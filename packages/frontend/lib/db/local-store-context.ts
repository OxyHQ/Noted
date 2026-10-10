import { createContext, useContext } from 'react';

export interface LocalStoreState {
  viewerId: string | null;
  isReady: boolean;
  error: string | null;
  retry: () => void;
}
export const LocalStoreContext = createContext<LocalStoreState>({
  viewerId: null, isReady: false, error: null, retry: () => undefined,
});
export const useLocalStoreState = () => useContext(LocalStoreContext);
