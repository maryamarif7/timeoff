import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HcmClientService } from './hcm-client.service';
import { SyncWorkerService } from './sync-worker.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [HcmClientService, SyncWorkerService],
  exports: [HcmClientService, SyncWorkerService],
})
export class SyncModule {}