import type { ReactNode } from 'react';

const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const make = (d: ReactNode) => function Icon() { return <svg {...base}>{d}</svg>; };

export const IconDesk = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" /></>);
export const IconUpload = make(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>);
export const IconFiles = make(<><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></>);
export const IconMoon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />);
export const IconOut = make(<><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" /><path d="M16 8l4 4-4 4M20 12H9" /></>);

/** Scanner-bracket mark with a marigold read-line: the product in one glyph. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="#0b7a75" />
      <path d="M11 17v-4a2 2 0 0 1 2-2h4M29 17v-4a2 2 0 0 0-2-2h-4M11 23v4a2 2 0 0 0 2 2h4M29 23v4a2 2 0 0 1-2 2h-4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M13 20h14" stroke="#ffb020" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}
