export interface FieldError { code: string; field: string | null; message: string }

/** Application error with a stable machine-readable code and an HTTP status. Safe to show to clients. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, errors: FieldError[] = [], code = 'BAD_REQUEST') => new AppError(400, code, message, errors);
export const validationFailed = (errors: FieldError[]) => new AppError(422, 'VALIDATION_FAILED', 'Request validation failed', errors);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHENTICATED') => new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} was not found`);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const payloadTooLarge = (message: string, code = 'PAYLOAD_TOO_LARGE') => new AppError(413, code, message);
export const notImplemented = (message: string, code = 'NOT_SUPPORTED') => new AppError(501, code, message);
