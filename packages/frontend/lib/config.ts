import { Platform } from 'react-native';

/**
 * Centralized API configuration
 * Priority:
 * 1. EXPO_PUBLIC_API_URL environment variable (from .env)
 * 2. Fallback to environment-based defaults
 */

/** Where the API listens in development. */
/** Nilo's API, Noted's server: its notes are Nilo's (`lib/api/routes.ts`). */
const DEV_API_PORT = 4001;

/**
 * The development API, reached on whatever host the app itself was opened from.
 *
 * Hardcoding a machine name here (it was `http://nate:3001`, when Noted had its own server) breaks for everyone
 * who is not on that machine, and in a browser it breaks even there unless the
 * name resolves — which is how local sync and the socket ended up failing while
 * the API was running perfectly well.
 *
 * Deriving it means `localhost:8081` talks to `localhost:4001` and a phone on
 * the LAN opening `192.168.1.x:8081` talks to `192.168.1.x:4001`, with no
 * configuration either way. `EXPO_PUBLIC_API_URL` still overrides it.
 */
export const DEV_API_BASE_URL =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:${String(DEV_API_PORT)}`
    : `http://localhost:${String(DEV_API_PORT)}`;
export const STAGING_API_BASE_URL = 'https://api.nilo.so';
export const PROD_API_BASE_URL = 'https://api.nilo.so';

const ENV = {
  dev: {
    apiUrl: DEV_API_BASE_URL,
  },
  staging: {
    apiUrl: STAGING_API_BASE_URL,
  },
  prod: {
    apiUrl: PROD_API_BASE_URL,
  },
};

const getEnvVars = () => {
  // Priority 1: Use EXPO_PUBLIC_API_URL if set in .env
  if (process.env.EXPO_PUBLIC_API_URL) {
    return {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
    };
  }

  // Priority 2: Use environment-based defaults
  const env = __DEV__ ? 'development' : 'production';

  if (env === 'production') {
    return ENV.prod;
  }

  // For web platform in development, always use localhost
  if (Platform.OS === 'web' && __DEV__) {
    return {
      apiUrl: DEV_API_BASE_URL,
    };
  }

  return ENV.dev;
};

export default getEnvVars();
