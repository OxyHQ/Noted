import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { listenForDesktopCommands, routeFor } from '@/lib/desktop/bridge';

/**
 * Act on what the Noted Desktop shell asks for (tray menu, global shortcut).
 * A no-op in the browser and on phones. Call once in the authenticated layout.
 */
export function useDesktopCommands() {
  const router = useRouter();

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void listenForDesktopCommands((command) => router.push(routeFor(command) as never)).then(
      (unlisten) => {
        // Unmounted while the shell's API was still loading: stop at once.
        if (cancelled) unlisten();
        else stop = unlisten;
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [router]);
}
