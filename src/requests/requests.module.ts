import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { RequestsRepository } from './requests.repository';
import { BalanceModule } from '../balance/balance.module';
import { SyncModule } from '../sync/sync.module';
import { AuditModule } from '../audit/audit.module'; 

@Module({
  imports: [BalanceModule, SyncModule,AuditModule],
  controllers: [RequestsController],
  providers: [RequestsService, RequestsRepository],
  exports: [RequestsService, RequestsRepository],
})
export class RequestsModule {}