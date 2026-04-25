import { Module } from '@nestjs/common';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { BalanceRepository } from './balance.repository';
import { SyncModule } from '../sync/sync.module';
import { AuditModule } from '../audit/audit.module'; 

@Module({ 
  imports: [SyncModule,AuditModule],
  controllers: [BalanceController],
  providers: [BalanceService, BalanceRepository],
  exports: [BalanceService, BalanceRepository],
})
export class BalanceModule {}