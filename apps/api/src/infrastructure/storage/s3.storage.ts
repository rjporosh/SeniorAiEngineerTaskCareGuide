import type { Readable } from 'node:stream';
import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { isValidStorageKey, type ObjectStoragePort } from '../../application/storage.js';

export interface S3Options { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string }

/** S3-compatible adapter (MinIO in Docker, or any S3 endpoint). Multipart streaming upload, bucket auto-created. */
export class S3ObjectStorage implements ObjectStoragePort {
  readonly provider = 'minio' as const;
  private readonly client: S3Client;
  private bucketReady: Promise<void> | null = null;

  constructor(private readonly o: S3Options) {
    this.client = new S3Client({
      endpoint: o.endpoint, region: o.region, forcePathStyle: true,
      credentials: { accessKeyId: o.accessKey, secretAccessKey: o.secretKey },
    });
  }
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try { await this.client.send(new HeadBucketCommand({ Bucket: this.o.bucket })); }
      catch { await this.client.send(new CreateBucketCommand({ Bucket: this.o.bucket })); }
    })().catch((e: unknown) => { this.bucketReady = null; throw e; });
    return this.bucketReady;
  }
  private checked(key: string): string {
    if (!isValidStorageKey(key)) throw new Error('Invalid storage key');
    return key;
  }
  async put(key: string, body: Readable, opts: { contentType: string }): Promise<void> {
    await this.ensureBucket();
    const upload = new Upload({
      client: this.client, queueSize: 2, partSize: 8 * 1024 * 1024, leavePartsOnError: false,
      params: { Bucket: this.o.bucket, Key: this.checked(key), Body: body, ContentType: opts.contentType },
    });
    await upload.done();
  }
  async get(key: string): Promise<Readable> {
    await this.ensureBucket();
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.o.bucket, Key: this.checked(key) }));
    return r.Body as Readable;
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.o.bucket, Key: this.checked(key) }));
  }
  async ping(): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new HeadBucketCommand({ Bucket: this.o.bucket }));
  }
}
