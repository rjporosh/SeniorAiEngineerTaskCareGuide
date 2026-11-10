'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api-client';

export interface Loaded<T> { data: T | null; error: ApiError | null; loading: boolean; reload: () => Promise<void> }

/**
 * Loads data and optionally polls while `keepPolling(data)` is true (real status updates, never simulated progress).
 * Stale responses from superseded requests are ignored.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], opts: { pollMs?: number; keepPolling?: (d: T) => boolean } = {}): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const loadRef = useRef(load); loadRef.current = load;
  const { pollMs, keepPolling } = opts;
  const keepRef = useRef(keepPolling); keepRef.current = keepPolling;

  const run = useCallback(async (silent: boolean) => {
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await loadRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (e) {
      if (id === seq.current) setState((s) => ({ data: silent ? s.data : null, error: e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Something went wrong. Try again.', []), loading: false }));
      return undefined;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined; let stopped = false;
    const tick = async (first: boolean) => {
      const d = await run(!first);
      if (stopped || !pollMs) return;
      if (d === undefined || keepRef.current?.(d) !== false) timer = setTimeout(() => void tick(false), pollMs);
    };
    void tick(true);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [run, pollMs]);

  return { ...state, reload: async () => { await run(true); } };
}
