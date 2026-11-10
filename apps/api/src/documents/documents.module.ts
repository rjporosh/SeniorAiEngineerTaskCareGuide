import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { ReviewService } from './review.service.js';
import { UploadService } from './upload.service.js';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, UploadService, ReviewService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
