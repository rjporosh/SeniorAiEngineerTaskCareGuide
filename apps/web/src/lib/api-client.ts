import type { FieldError } from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly errors: FieldError[], public readonly traceId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> { success: boolean; data?: T; message?: string; code?: string; errors?: FieldError[]; traceId?: string }
const HEADERS = { 'x-requested-with': 'docint' };

/** Calls the API through the same-origin BFF. Throws ApiError with every field error the server reported. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path}`, {
      ...rest, cache: 'no-store',
      headers: { ...HEADERS, ...(json !== undefined && { 'content-type': 'application/json' }), ...(headers as Record<string, string>) },
      ...(json !== undefined && { body: JSON.stringify(json) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.', []);
  }
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success) {
    if (res.status === 401 && typeof window !== 'undefined') window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new ApiError(res.status, body?.code ?? 'ERROR', body?.message ?? 'Something went wrong. Try again.', body?.errors ?? [], body?.traceId);
  }
  return body.data as T;
}

export const qs = (params: Record<string, string | number | undefined | null>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};
