import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

type Json = { type?: string | string[]; enum?: unknown[]; default?: unknown; description?: string; properties?: Record<string, Json>; required?: string[] };

const toJson = (schema: z.ZodType): Json => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Json;

/** Documents a request body from the same zod schema that validates it, so docs cannot drift from behaviour. */
export const ZodBody = (schema: z.ZodType) => ApiBody({ schema: toJson(schema) as Record<string, unknown> });

/** Documents every query parameter of a zod object schema (type, enum, default, required). */
export const ZodQuery = (schema: z.ZodType) => {
  const json = toJson(schema);
  return applyDecorators(...Object.entries(json.properties ?? {}).map(([name, p]) => {
    const type = (Array.isArray(p.type) ? p.type[0] : p.type) as 'string' | 'number' | 'integer' | 'boolean' | undefined;
    return ApiQuery({ name, required: (json.required ?? []).includes(name) && p.default === undefined, enum: p.enum as string[] | undefined, schema: { type: type ?? 'string', default: p.default as never } });
  }));
};

const ERRORS = { 400: 'Validation failed — every problem is listed in `errors`', 401: 'Missing or invalid credentials', 403: 'Role not allowed', 404: 'Not found', 429: 'Rate limit exceeded' } as const;

/** Standard operation docs: summary, description, auth requirement and the error responses the envelope can carry. */
export const Op = (summary: string, opts: { description?: string; auth?: boolean; errors?: (keyof typeof ERRORS)[]; ok?: string; status?: number } = {}) =>
  applyDecorators(
    ApiOperation({ summary, description: opts.description }),
    ApiResponse({ status: opts.status ?? 200, description: opts.ok ?? 'Success envelope: `{ success: true, data, traceId, timestamp }`' }),
    ...(opts.auth === false ? [] : [ApiBearerAuth()]),
    ...(opts.errors ?? [400, 401, 403, 404, 429]).filter((c) => opts.auth !== false || c !== 401).map((c) => ApiResponse({ status: c, description: ERRORS[c] })),
  );

export { ApiTags, ApiConsumes };
export const MultipartFiles = () => applyDecorators(ApiConsumes('multipart/form-data'), ApiBody({
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'PDF, JPG, PNG, TIFF, XLSX, XLS or CSV files (signature-checked server side)' } } },
}));
