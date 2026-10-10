import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

export type SettingsPage = 'account' | 'general' | 'transcription' | 'feedback' | 'storage';
interface SettingsContextValue {
  open: (page?: SettingsPage) => void;
  close: () => void;
  afterClose: (action: () => void) => void;
}
const SettingsContext = createContext<SettingsContextValue | null>(null);
const SettingsModal = lazy(() => import('./settings-modal'));

/** Load the dialog only on demand; startup never depends on settings or translation hooks. */
export function NotedSettingsProvider({ children }: PropsWithChildren) {
  const [request, setRequest] = useState<{ page: SettingsPage; initialView: 'navigation' | 'page' } | null>(null);
  const open = useCallback((page?: SettingsPage) => {
    setRequest({ page: page ?? 'general', initialView: page ? 'page' : 'navigation' });
  }, []);
  const close = useCallback(() => setRequest(null), []);
  const afterClose = useCallback((action: () => void) => {
    setRequest(null);
    // Oxy owns its account/language surfaces. Unmount Bloom's focus trap first.
    requestAnimationFrame(action);
  }, []);
  const value = useMemo(() => ({ open, close, afterClose }), [open, close, afterClose]);
  return <SettingsContext.Provider value={value}>
    {children}
    {request && <Suspense fallback={null}>
      <SettingsModal page={request.page} initialView={request.initialView} onClose={close} />
    </Suspense>}
  </SettingsContext.Provider>;
}

export function useNotedSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useNotedSettings requires NotedSettingsProvider');
  return context;
}
