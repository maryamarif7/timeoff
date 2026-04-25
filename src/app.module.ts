import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { BalanceModule } from './balance/balance.module';
import { RequestsModule } from './requests/requests.module';
import { SyncModule } from './sync/sync.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AuditModule } from './audit/audit.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRY ?? '1h' },
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuditModule,
    BalanceModule,
    RequestsModule,
    SyncModule,
    WebhooksModule,
  ],
})
export class AppModule {}