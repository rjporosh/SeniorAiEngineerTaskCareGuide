import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorNotice, Pager, ReviewStamp, SeverityBadge, StatusBadge } from './ui';

vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

describe('status components', () => {
  it('describes processing state in words, not colour alone', () => {
    render(<><StatusBadge status="completed" /><StatusBadge status="failed" /><StatusBadge status="ocr" /></>);
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Recognising text')).toBeTruthy();
  });
  it('shows a stamp only when a person needs to act', () => {
    const { container, rerender } = render(<ReviewStamp status="pending" />);
    expect(screen.getByText('Needs review').className).toContain('stamp');
    rerender(<ReviewStamp status="not_required" />);
    expect(container.querySelector('.stamp')).toBeNull();
    expect(screen.getByText('Clear')).toBeTruthy();
  });
  it('labels severities in plain language', () => {
    render(<><SeverityBadge severity="error" /><SeverityBadge severity="warning" /><SeverityBadge severity="info" /></>);
    for (const t of ['Must fix', 'Check', 'Note']) expect(screen.getByText(t)).toBeTruthy();
  });
});

describe('ErrorNotice', () => {
  it('lists every field error and the support reference', () => {
    render(<ErrorNotice error={{ message: 'Request validation failed', errors: [{ field: 'page', message: 'too small' }, { field: 'status', message: 'invalid' }], traceId: 'abc-123' }} />);
    expect(screen.getByRole('alert').textContent).toContain('page: too small');
    expect(screen.getByRole('alert').textContent).toContain('status: invalid');
    expect(screen.getByText('abc-123')).toBeTruthy();
  });
});

describe('Pager and EmptyState', () => {
  it('disables navigation at the ends and reports the visible range', () => {
    const onPage = vi.fn();
    render(<Pager page={1} pageSize={15} total={32} onPage={onPage} />);
    expect(screen.getByText('1–15 of 32')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    screen.getByRole('button', { name: 'Next' }).click();
    expect(onPage).toHaveBeenCalledWith(2);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  });
  it('gives an empty state a next step', () => {
    render(<EmptyState title="No documents yet" action={{ href: '/upload', label: 'Upload your first documents' }}>Uploads show up here.</EmptyState>);
    expect(screen.getByRole('link', { name: 'Upload your first documents' }).getAttribute('href')).toBe('/upload');
  });
});
