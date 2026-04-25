import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';


interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'create_balance_records',
    sql: `
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
    `,
  },
  {
    version: 2,
    name: 'create_time_off_requests',
    sql: `
      CREATE TABLE IF NOT EXISTS time_off_requests (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        leave_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        days REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED','SYNCING')),
        hcm_ref TEXT,
        rejection_reason TEXT,
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_requests_employee ON time_off_requests(employee_id);
      CREATE INDEX IF NOT EXISTS idx_requests_status   ON time_off_requests(status);
      CREATE INDEX IF NOT EXISTS idx_requests_composite
        ON time_off_requests(employee_id, location_id, leave_type, status);
    `,
  },
  {
    version: 3,
    name: 'create_sync_events',
    sql: `
      CREATE TABLE IF NOT EXISTS sync_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        employee_id TEXT,
        location_id TEXT,
        leave_type TEXT,
        direction TEXT CHECK(direction IN ('INBOUND','OUTBOUND',NULL)),
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'SUCCESS'
          CHECK(status IN ('SUCCESS','FAILURE','PARTIAL')),
        error_message TEXT,
        event_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_events_event_id   ON sync_events(event_id);
      CREATE INDEX IF NOT EXISTS idx_sync_events_employee   ON sync_events(employee_id);
      CREATE INDEX IF NOT EXISTS idx_sync_events_created_at ON sync_events(created_at);
    `,
  },
  {
    version: 4,
    name: 'create_idempotency_keys',
    sql: `
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key_value TEXT PRIMARY KEY,
        response_code INTEGER,
        response_body TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys(expires_at);
    `,
  },
  {
    version: 5,
    name: 'create_job_queue',
    sql: `
      CREATE TABLE IF NOT EXISTS job_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK(status IN ('PENDING','DONE','DEAD')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_run_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_job_queue_runnable
        ON job_queue(status, next_run_at)
        WHERE status = 'PENDING';
    `,
  },
];

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  onModuleInit(): void {
    this.ensureMigrationsTable();
    this.runMigrations();
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version  INTEGER PRIMARY KEY,
        name     TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  private getAppliedVersions(): Set<number> {
    const rows = this.db
      .prepare(`SELECT version FROM schema_migrations`)
      .all() as { version: number }[];
    return new Set(rows.map((r) => r.version));
  }

  private runMigrations(): void {
    const applied = this.getAppliedVersions();
    const pending = MIGRATIONS.filter((m) => !applied.has(m.version));

    if (pending.length === 0) {
      this.logger.log('Database schema is up to date');
      return;
    }

  
    const runAll = this.db.transaction(() => {
      for (const migration of pending) {
        this.logger.log(`Applying migration ${migration.version}: ${migration.name}`);
        this.db.exec(migration.sql);
        this.db
          .prepare(
            `INSERT INTO schema_migrations (version, name, applied_at)
             VALUES (?, ?, ?)`,
          )
          .run(migration.version, migration.name, new Date().toISOString());
      }
    });

    try {
      runAll();
      this.logger.log(`Applied ${pending.length} migration(s) successfully`);
    } catch (err) {
      this.logger.error('Migration failed — rolling back', err);
      throw err; 
    }
  }

  getDb(): Database.Database {
    return this.db;
  }


  getAppliedMigrations(): { version: number; name: string; applied_at: string }[] {
    return this.db
      .prepare(`SELECT * FROM schema_migrations ORDER BY version`)
      .all() as any[];
  }
}