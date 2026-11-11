import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/bricolage-grotesque/wdth.css';
import '@fontsource-variable/instrument-sans/index.css';
import '@fontsource/noto-sans-bengali/bengali-400.css';
import '@fontsource/noto-sans-bengali/bengali-700.css';
import './globals.css';

export const metadata: Metadata = { title: { default: 'Document Intelligence', template: '%s · Document Intelligence' }, description: 'Upload invoices, check what was extracted, fix what is wrong.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Applies the saved theme before first paint to avoid a flash.
const THEME_INIT = "try{var t=localStorage.getItem('docint-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body>{children}</body>
    </html>
  );
}
