import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

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
  const sequence = useRef(0);
  const pendingAction = useRef<(() => void) | null>(null);
  const [request, setRequest] = useState<{ id: number; page: SettingsPage; initialView: 'navigation' | 'page' } | null>(null);
  const open = useCallback((page?: SettingsPage) => {
    pendingAction.current = null;
    setRequest({ id: ++sequence.current, page: page ?? 'general', initialView: page ? 'page' : 'navigation' });
  }, []);
  const close = useCallback(() => setRequest(null), []);
  const afterClose = useCallback((action: () => void) => {
    if (!request) { action(); return; }
    pendingAction.current = action;
    setRequest(null);
  }, [request]);
  // Oxy owns account/language surfaces. Open them only after the settings
  // dialog and its focus trap have actually unmounted.
  useEffect(() => {
    if (request || !pendingAction.current) return;
    const action = pendingAction.current;
    pendingAction.current = null;
    action();
  }, [request]);
  const value = useMemo(() => ({ open, close, afterClose }), [open, close, afterClose]);
  return <SettingsContext.Provider value={value}>
    {children}
    {request && <Suspense fallback={null}>
      <SettingsModal key={request.id} page={request.page} initialView={request.initialView} onClose={close} />
    </Suspense>}
  </SettingsContext.Provider>;
}

export function useNotedSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useNotedSettings requires NotedSettingsProvider');
  return context;
}
