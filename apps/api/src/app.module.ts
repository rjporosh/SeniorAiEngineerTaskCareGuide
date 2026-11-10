import { Module } from '@nestjs/common';
import { ConfigModule } from './config.module.js';
import { HealthController } from './health/health.controller.js';
import { PersistenceModule } from './persistence.module.js';

@Module({
  imports: [ConfigModule, PersistenceModule],
  controllers: [HealthController],
})
export class AppModule {}
