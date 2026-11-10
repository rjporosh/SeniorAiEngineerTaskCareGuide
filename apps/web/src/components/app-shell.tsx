'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import type { Me } from '@/lib/types';
import { IconDesk, IconFiles, IconMoon, IconOut, IconSearch, IconUpload } from './icons';
import { ToastProvider } from './toast';

const NAV = [
  { href: '/', label: 'Desk', Icon: IconDesk },
  { href: '/upload', label: 'Upload', Icon: IconUpload },
  { href: '/documents', label: 'Documents', Icon: IconFiles },
  { href: '/search', label: 'Search', Icon: IconSearch },
];

function applyTheme(t: 'light' | 'dark') { document.documentElement.dataset['theme'] = t; try { localStorage.setItem('docint-theme', t); } catch { /* storage may be blocked */ } }

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { void api<Me>('auth/me').then(setMe).catch(() => undefined); }, []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-requested-with': 'docint' } }).catch(() => undefined);
    router.replace('/login');
  }
  function toggleTheme() {
    const dark = document.documentElement.dataset['theme'] === 'dark' || (!document.documentElement.dataset['theme'] && matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(dark ? 'light' : 'dark');
  }

  return (
    <ToastProvider>
      <a className="skip" href="#content">Skip to content</a>
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <div className="brand" aria-hidden="true">Doc<br />Intel</div>
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={href === '/' ? (path === '/' ? 'page' : undefined) : path.startsWith(href) ? 'page' : undefined}><Icon />{label}</Link>
          ))}
          <div className="spacer" />
          <button type="button" className="rail-btn" onClick={toggleTheme} aria-label="Switch between light and dark theme"><IconMoon />Theme</button>
          <button type="button" className="rail-btn" onClick={signOut} title={me?.email}><IconOut />Sign out</button>
        </nav>
        <main id="content" className="main" tabIndex={-1}>{children}</main>
      </div>
    </ToastProvider>
  );
}
