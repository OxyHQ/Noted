import { setWasmUrl } from '@lottiefiles/dotlottie-react';
import { Asset } from 'expo-asset';

let configured = false;

/** Serve the sticker renderer with the app instead of fetching it from a CDN. */
export function configureLottieWeb(): void {
  if (configured) return;
  const wasm = Asset.fromModule(require('@lottiefiles/dotlottie-web/dotlottie-player.wasm'));
  setWasmUrl(wasm.uri);
  configured = true;
}
