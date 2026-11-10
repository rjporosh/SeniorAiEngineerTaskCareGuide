import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext { correlationId: string; userId?: string; ip?: string }
const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);
export const currentContext = (): RequestContext | undefined => storage.getStore();
export const currentCorrelationId = (): string => storage.getStore()?.correlationId ?? 'no-request';
