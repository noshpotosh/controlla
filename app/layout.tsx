import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Controlla — Phone-powered party games',
  description:
    'Create a room, connect your screens, and turn every phone into a game controller.',
  // Launched from the Home Screen, phones get the controller with no browser
  // chrome (iPhone Safari can't hide its toolbar any other way).
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Controlla',
    statusBarStyle: 'black-translucent',
  },
  // Older iOS reads only the prefixed tag.
  other: { 'apple-mobile-web-app-capable': 'yes' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#181c35',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
