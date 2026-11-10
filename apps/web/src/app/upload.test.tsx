import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UploadPage from './(app)/upload/page';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const pick = (...files: File[]) => fireEvent.change(screen.getByLabelText('Choose files'), { target: { files } });

describe('UploadPage', () => {
  it('rejects unsupported files immediately with a reason and offers no upload for them', () => {
    render(<UploadPage />);
    pick(new File(['x'], 'malware.exe'));
    expect(screen.getByText(/".exe" files are not supported/)).toBeTruthy();
    expect(screen.getByText('Not accepted')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Upload 0 files/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('queues valid files and enables upload with an accurate count', () => {
    render(<UploadPage />);
    pick(new File(['%PDF-'], 'a.pdf'), new File(['%PDF-'], 'b.pdf'), new File(['x'], 'bad.txt'));
    expect(screen.getByRole('button', { name: 'Upload 2 files' })).toBeTruthy();
    expect(screen.getByText('3 files')).toBeTruthy();
  });
});
