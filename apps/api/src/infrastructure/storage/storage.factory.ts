import type { ObjectStoragePort } from '../../application/storage.js';
import type { AppConfig } from '../../config/env.schema.js';
import { LocalObjectStorage } from './local.storage.js';
import { S3ObjectStorage } from './s3.storage.js';

type StorageConfig = Pick<AppConfig, 'OBJECT_STORAGE_PROVIDER' | 'STORAGE_LOCAL_ROOT' | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY'>;

export function createStorage(c: StorageConfig): ObjectStoragePort {
  if (c.OBJECT_STORAGE_PROVIDER === 'local') return new LocalObjectStorage(c.STORAGE_LOCAL_ROOT);
  return new S3ObjectStorage({
    endpoint: c.S3_ENDPOINT ?? '', region: c.S3_REGION, bucket: c.S3_BUCKET, accessKey: c.S3_ACCESS_KEY ?? '', secretKey: c.S3_SECRET_KEY ?? '',
  });
}
