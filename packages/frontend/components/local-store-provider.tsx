import type { ReactNode } from 'react';
import { LocalStoreContext } from '@/lib/db/local-store-context';
import { useLocalStore } from '@/lib/db/use-local-store';
import { CaptureEngineHost } from '@/components/capture/capture-engine-host';

export function LocalStoreProvider({ children }: { children: ReactNode }) {
  const state = useLocalStore();
  return <LocalStoreContext.Provider value={state}>
    {children}
    {state.isReady && <CaptureEngineHost key={state.viewerId} />}
  </LocalStoreContext.Provider>;
}
