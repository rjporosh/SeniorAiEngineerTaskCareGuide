import { Global, Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG } from '../app.tokens.js';
import type { AppConfig } from '../config/env.schema.js';
import type { Repositories } from '../application/ports.js';
import type { QueuePort } from '../application/queue.js';
import type { ObjectStoragePort } from '../application/storage.js';
import { RulesInvoiceExtractor } from '../extraction/rules-extractor.js';
import type { InvoiceExtractorPort } from '../extraction/types.js';
import type { HealthProbe } from '../health/health.tokens.js';
import { REPOSITORIES } from '../persistence.module.js';
import { QUEUE } from '../queue.module.js';
import { STORAGE } from '../storage.module.js';
import { DocumentValidator } from './document-validator.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { HttpDocumentProcessor, type DocumentProcessorPort } from './processor.client.js';

export const DOCUMENT_PROCESSOR = Symbol('DOCUMENT_PROCESSOR');
export const INVOICE_EXTRACTOR = Symbol('INVOICE_EXTRACTOR');
export const PROCESSING_SERVICE = Symbol('PROCESSING_SERVICE');
export const DOCUMENT_VALIDATOR = Symbol('DOCUMENT_VALIDATOR');

@Global()
@Module({
  providers: [
    {
      provide: DOCUMENT_PROCESSOR, inject: [APP_CONFIG],
      useFactory: (c: AppConfig): DocumentProcessorPort => new HttpDocumentProcessor(c.PROCESSOR_BASE_URL, c.PROCESSOR_SERVICE_TOKEN, (c.PROCESSING_TIMEOUT_SECONDS + 30) * 1000),
    },
    { provide: INVOICE_EXTRACTOR, useFactory: (): InvoiceExtractorPort => new RulesInvoiceExtractor() },
    { provide: DOCUMENT_VALIDATOR, inject: [REPOSITORIES], useFactory: (r: Repositories) => new DocumentValidator(r) },
    {
      provide: PROCESSING_SERVICE, inject: [REPOSITORIES, STORAGE, DOCUMENT_PROCESSOR, INVOICE_EXTRACTOR, DOCUMENT_VALIDATOR],
      useFactory: (r: Repositories, s: ObjectStoragePort, p: DocumentProcessorPort, e: InvoiceExtractorPort, v: DocumentValidator) =>
        new DocumentProcessingService(r, s, p, e, undefined, v),
    },
  ],
  exports: [DOCUMENT_PROCESSOR, INVOICE_EXTRACTOR, PROCESSING_SERVICE, DOCUMENT_VALIDATOR],
})
export class ProcessingModule implements OnApplicationBootstrap {
  private readonly log = new Logger('Worker');
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(PROCESSING_SERVICE) private readonly service: DocumentProcessingService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.WORKER_ENABLED) { this.log.log('worker disabled (WORKER_ENABLED=false)'); return; }
    // Do not block HTTP start-up on the broker: the adapters reconnect on their own.
    void this.queue.startConsumer(this.service.handle, { concurrency: this.cfg.QUEUE_CONCURRENCY })
      .then(() => this.log.log(`consuming document.process (concurrency ${this.cfg.QUEUE_CONCURRENCY})`))
      .catch((e: unknown) => this.log.error(`could not start consumer: ${(e as Error).message}`));
  }
}

export const processorHealthProbe = (p: DocumentProcessorPort): HealthProbe => ({ name: 'processor', check: () => p.ping() });
