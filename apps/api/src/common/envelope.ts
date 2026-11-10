import type { FieldError } from './errors.js';

export interface SuccessEnvelope<T> { success: true; message?: string; data: T; traceId: string; timestamp: string }
export interface FailureEnvelope { success: false; message: string; code: string; errors: FieldError[]; traceId: string; timestamp: string }
export type Envelope<T> = SuccessEnvelope<T> | FailureEnvelope;

export const success = <T>(data: T, traceId: string, message?: string): SuccessEnvelope<T> => ({
  success: true, ...(message !== undefined && { message }), data, traceId, timestamp: new Date().toISOString(),
});
export const failure = (code: string, message: string, errors: FieldError[], traceId: string): FailureEnvelope => ({
  success: false, message, code, errors, traceId, timestamp: new Date().toISOString(),
});
