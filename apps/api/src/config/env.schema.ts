import { z } from 'zod';

const csv = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.string().default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    CORS_ORIGINS: csv.default(['http://localhost:3000']),

    DATABASE_PROVIDER: z.enum(['postgres', 'mongodb', 'memory']).default('postgres'),
    DATABASE_URL: z.string().optional(),
    MONGODB_URI: z.string().optional(),

    QUEUE_PROVIDER: z.enum(['rabbitmq', 'bullmq']).default('rabbitmq'),
    RABBITMQ_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),

    QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    QUEUE_RETRY_BASE_MS: z.coerce.number().int().min(10).default(2000),
    QUEUE_RETRY_MAX_MS: z.coerce.number().int().min(10).default(60000),
    QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),

    OBJECT_STORAGE_PROVIDER: z.enum(['minio', 'local']).default('minio'),
    STORAGE_LOCAL_ROOT: z.string().default('./storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_BUCKET: z.string().default('documents'),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),

    WORKER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    PROCESSOR_BASE_URL: z.string().default('http://processor:8000'),
    PROCESSOR_SERVICE_TOKEN: z.string().min(16),

    METRICS_TOKEN: z.string().min(16).optional(),
    SEED_ADMIN_EMAIL: z.email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
    API_DOCS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

    MAX_FILE_SIZE_MB: z.coerce.number().positive().default(50),
    MAX_BATCH_SIZE_MB: z.coerce.number().positive().default(200),
    MAX_FILES_PER_BATCH: z.coerce.number().int().positive().default(20),
    MAX_PDF_PAGES: z.coerce.number().int().positive().default(1000),
    MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(60_000_000),
    MAX_SPREADSHEET_ROWS: z.coerce.number().int().positive().default(200_000),
    PROCESSING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  })
  .superRefine((env, ctx) => {
    const need = (ok: boolean, path: string, why: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message: why });
    };
    need(env.DATABASE_PROVIDER !== 'postgres' || !!env.DATABASE_URL, 'DATABASE_URL', 'required when DATABASE_PROVIDER=postgres');
    need(env.DATABASE_PROVIDER !== 'mongodb' || !!env.MONGODB_URI, 'MONGODB_URI', 'required when DATABASE_PROVIDER=mongodb');
    need(env.QUEUE_PROVIDER !== 'rabbitmq' || !!env.RABBITMQ_URL, 'RABBITMQ_URL', 'required when QUEUE_PROVIDER=rabbitmq');
    need(env.QUEUE_PROVIDER !== 'bullmq' || !!env.REDIS_URL, 'REDIS_URL', 'required when QUEUE_PROVIDER=bullmq');
    need(env.OBJECT_STORAGE_PROVIDER !== 'minio' || (!!env.S3_ENDPOINT && !!env.S3_ACCESS_KEY && !!env.S3_SECRET_KEY), 'S3_ENDPOINT', 'S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY required when OBJECT_STORAGE_PROVIDER=minio');
    need(!(env.NODE_ENV === 'production' && env.DATABASE_PROVIDER === 'memory'), 'DATABASE_PROVIDER', 'memory provider is not allowed in production');
  });

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}
