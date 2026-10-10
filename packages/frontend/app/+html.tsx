import { type PropsWithChildren } from 'react';

/**
 * Root HTML component for static rendering
 * This file runs during static rendering in Node.js for SEO optimization
 * Don't wrap your app with Providers here - that should be in _layout.tsx
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />

        {/* Viewport and mobile optimization */}
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* Security and Performance */}
        <meta httpEquiv="Content-Security-Policy" content="upgrade-insecure-requests" />
        <meta name="referrer" content="origin-when-cross-origin" />

        {/* Primary Meta Tags */}
        <meta name="title" content="Noted" />
        <meta
          name="description"
          content="Capture notes, lists and meetings with Noted by Oxy. Keep your notes on your device and transcribe recordings locally."
        />

        {/* Open Graph / Facebook Meta Tags for social sharing */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://noted.oxy.so/" />
        <meta property="og:title" content="Noted" />
        <meta
          property="og:description"
          content="Capture notes, lists and meetings with Noted by Oxy. Keep your notes on your device and transcribe recordings locally."
        />
        <meta property="og:image" content="https://noted.oxy.so/icon-512.png" />

        {/* Twitter Card Meta Tags */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content="https://noted.oxy.so/" />
        <meta property="twitter:title" content="Noted" />
        <meta
          property="twitter:description"
          content="Capture notes, lists and meetings with Noted by Oxy. Keep your notes on your device and transcribe recordings locally."
        />
        <meta property="twitter:image" content="https://noted.oxy.so/icon-512.png" />

        {/* Theme color for mobile browsers */}
        <meta name="theme-color" content="#fbbc04" />
        <meta name="msapplication-TileColor" content="#fbbc04" />

        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Favicons */}
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
        <link rel="shortcut icon" href="/icon-192.png" />

        {/* Apple Touch Icons for iOS home screen */}
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="167x167" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/icon-192.png" />

        {/* Apple Mobile Web App */}
        <meta name="apple-mobile-web-app-title" content="Noted" />

        {/* Preconnect to important domains for performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* JSON-LD Structured Data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'Noted',
              url: 'https://noted.oxy.so',
              description:
                'Capture notes, lists and meetings with Noted by Oxy. Keep your notes on your device and transcribe recordings locally.',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web, iOS, Android',
            }),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
