import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams('next=/documents') }));

afterEach(() => { vi.unstubAllGlobals(); replace.mockReset(); });
const submit = () => { fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.io' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw-pw-pw-pw-pw' } }); fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); };

describe('LoginPage', () => {
  it('shows the server message when credentials are wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, message: 'Invalid email or password', errors: [] }), { status: 401 })));
    render(<LoginPage />);
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password');
    expect(replace).not.toHaveBeenCalled();
  });
  it('explains rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, message: 'x', errors: [] }), { status: 429 })));
    render(<LoginPage />);
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Too many attempts');
  });
  it('sends the CSRF header and continues to the requested page', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);
    submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/documents'));
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['x-requested-with']).toBe('docint');
  });
  it('survives a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    render(<LoginPage />);
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Cannot reach the server');
  });
});
