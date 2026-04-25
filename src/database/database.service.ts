import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from './database.module';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  onModuleInit() {
    this.runMigrations();
  }

  private runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS balance_records (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        leave_type TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        locked_days REAL NOT NULL DEFAULT 0,
        hcm_version TEXT,
        synced_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(employee_id, location_id, leave_type)
      );

      CREATE TABLE IF NOT EXISTS time_off_requests (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        leave_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        days REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        hcm_ref TEXT,
        rejection_reason TEXT,
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_requests_employee ON time_off_requests(employee_id);
      CREATE INDEX IF NOT EXISTS idx_requests_status ON time_off_requests(status);

      CREATE TABLE IF NOT EXISTS sync_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        employee_id TEXT,
        location_id TEXT,
        leave_type TEXT,
        direction TEXT,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'SUCCESS',
        error_message TEXT,
        event_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_events_event_id ON sync_events(event_id);

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key_value TEXT PRIMARY KEY,
        response_code INTEGER,
        response_body TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_run_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_message TEXT
      );
    `);
    this.logger.log('Database migrations completed');
  }

  getDb(): Database.Database {
    return this.db;
  }
}