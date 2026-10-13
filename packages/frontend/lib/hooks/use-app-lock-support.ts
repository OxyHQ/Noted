import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Whether this device can authenticate the person right now: hardware present AND
 * something enrolled (a face, a fingerprint or a passcode). `null` while it is
 * being asked. Never true on the web, which has no such prompt.
 */
export function useCanAuthenticate(): boolean | null {
  const [can, setCan] = useState<boolean | null>(Platform.OS === 'web' ? false : null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let live = true;
    void (async () => {
      try {
        const [hardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (live) setCan(hardware && enrolled);
      } catch {
        // If the platform cannot even say, there is no lock to offer.
        if (live) setCan(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return can;
}
