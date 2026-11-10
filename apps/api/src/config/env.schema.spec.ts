import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@h:5432/d',
  RABBITMQ_URL: 'amqp://h',
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  PROCESSOR_SERVICE_TOKEN: 'x'.repeat(16),
  JWT_ACCESS_SECRET: 'y'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults for the primary profile', () => {
    const c = loadConfig(base);
    expect(c.DATABASE_PROVIDER).toBe('postgres');
    expect(c.QUEUE_PROVIDER).toBe('rabbitmq');
    expect(c.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });
  it('accepts a bare host:port processor address from a hosting platform', () => {
    expect(loadConfig({ ...base, PROCESSOR_BASE_URL: 'docint-processor:10000' }).PROCESSOR_BASE_URL).toBe('http://docint-processor:10000');
    expect(loadConfig({ ...base, PROCESSOR_BASE_URL: 'https://p.example.com/' }).PROCESSOR_BASE_URL).toBe('https://p.example.com');
  });
  it('fails fast on unknown provider', () => {
    expect(() => loadConfig({ ...base, DATABASE_PROVIDER: 'oracle' })).toThrow(ConfigError);
  });
  it('requires provider-specific settings', () => {
    expect(() => loadConfig({ ...base, QUEUE_PROVIDER: 'bullmq' })).toThrow(/REDIS_URL/);
  });
  it('rejects memory provider in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DATABASE_PROVIDER: 'memory' })).toThrow(/production/);
  });
  it('rejects short secrets', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(ConfigError);
  });
});
