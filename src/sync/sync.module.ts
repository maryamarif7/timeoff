import { Module } from '@nestjs/common';
import { HcmClientService } from './hcm-client.service';
import { SyncWorkerService } from './sync-worker.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [HcmClientService, SyncWorkerService],
  exports: [HcmClientService, SyncWorkerService],
})
export class SyncModule {}