import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import Database from 'better-sqlite3';
import { DatabaseModule, DB_TOKEN } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { AuditModule } from '../audit/audit.module';
import { SyncModule } from '../sync/sync.module';
import { BalanceModule } from '../balance/balance.module';
import { RequestsModule } from '../requests/requests.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AppModule } from '../app.module';

export function buildTestConfig(hcmBaseUrl: string) {
  return () => ({
    port: 3001,
    jwt: { secret: 'test-secret', expiry: '1h' },
    hcm: {
      baseUrl: hcmBaseUrl,
      apiKey: 'test-key',
      webhookSecret: 'test-webhook-secret',
      maxRetries: 1,
      timeoutMs: 2000,
    },
    database: { path: ':memory:' },
    sync: { verificationDelayMs: 50 },
  });
}

export async function createTestModule(hcmBaseUrl: string): Promise<TestingModule> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [buildTestConfig(hcmBaseUrl)] }),
      ScheduleModule.forRoot(),
      JwtModule.registerAsync({
        useFactory: () => ({ secret: 'test-secret' }),
        global: true,
      }),
      DatabaseModule,
      AuditModule,
      SyncModule,
      BalanceModule,
      RequestsModule,
      WebhooksModule,
    ],
    providers: [DatabaseService],
  }).compile();

  // Run migrations
  module.get(DatabaseService).onModuleInit();

  return module;
}

export function makeJwt(payload: object): string {
  const { JwtService } = require('@nestjs/jwt');
  const svc = new JwtService({ secret: 'test-secret' });
  return svc.sign(payload);
}

export const EMPLOYEE_TOKEN = makeJwt({ sub: 'emp-1', role: 'employee' });
export const MANAGER_TOKEN = makeJwt({ sub: 'mgr-1', role: 'manager' });
export const ADMIN_TOKEN = makeJwt({ sub: 'admin-1', role: 'admin' });