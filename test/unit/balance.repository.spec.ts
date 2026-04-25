import Database from 'better-sqlite3';
import { BalanceRepository } from '../../src/balance/balance.repository';
import { DatabaseService } from '../../src/database/database.service';

function buildDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  // Run migrations inline
  db.exec(`
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
  `);
  return db;
}

describe('BalanceRepository', () => {
  let db: Database.Database;
  let repo: BalanceRepository;

  beforeEach(() => {
    db = buildDb();
    repo = new BalanceRepository(db);
  });

  afterEach(() => db.close());

  describe('upsert', () => {
    it('creates a new record when none exists', () => {
      const rec = repo.upsert('emp-1', 'loc-1', 'vacation', 10);
      expect(rec.balance).toBe(10);
      expect(rec.lockedDays).toBe(0);
    });

    it('updates balance on second upsert', () => {
      repo.upsert('emp-1', 'loc-1', 'vacation', 10);
      repo.upsert('emp-1', 'loc-1', 'vacation', 15, 'v2');
      const rec = repo.findOne('emp-1', 'loc-1', 'vacation');
      expect(rec!.balance).toBe(15);
      expect(rec!.hcmVersion).toBe('v2');
    });

    it('upsert stores hcmVersion', () => {
      const rec = repo.upsert('emp-1', 'loc-1', 'sick', 5, 'hcm-v1');
      expect(rec.hcmVersion).toBe('hcm-v1');
    });
  });

  describe('lockDays / releaseLock', () => {
    it('lockDays increases lockedDays', () => {
      repo.upsert('emp-1', 'loc-1', 'vacation', 10);
      repo.lockDays('emp-1', 'loc-1', 'vacation', 3);
      const rec = repo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(rec.lockedDays).toBe(3);
    });

    it('releaseLock decreases lockedDays', () => {
      repo.upsert('emp-1', 'loc-1', 'vacation', 10);
      repo.lockDays('emp-1', 'loc-1', 'vacation', 3);
      repo.releaseLock('emp-1', 'loc-1', 'vacation', 3);
      const rec = repo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(rec.lockedDays).toBe(0);
    });

    it('releaseLock never goes below 0', () => {
      repo.upsert('emp-1', 'loc-1', 'vacation', 10);
      repo.releaseLock('emp-1', 'loc-1', 'vacation', 999);
      const rec = repo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(rec.lockedDays).toBe(0);
    });
  });

  describe('commitDeduction', () => {
    it('reduces balance and lockedDays together', () => {
      repo.upsert('emp-1', 'loc-1', 'vacation', 10);
      repo.lockDays('emp-1', 'loc-1', 'vacation', 3);
      repo.commitDeduction('emp-1', 'loc-1', 'vacation', 3);
      const rec = repo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(rec.balance).toBe(7);
      expect(rec.lockedDays).toBe(0);
    });

    it('balance never goes below 0', () => {
      repo.upsert('emp-1', 'loc-1', 'vacation', 2);
      repo.commitDeduction('emp-1', 'loc-1', 'vacation', 5);
      const rec = repo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(rec.balance).toBe(0);
    });
  });

  describe('creditBack', () => {
    it('increases balance after credit-back', () => {
      repo.upsert('emp-1', 'loc-1', 'vacation', 7);
      repo.creditBack('emp-1', 'loc-1', 'vacation', 3);
      const rec = repo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(rec.balance).toBe(10);
    });
  });

  describe('findByEmployee', () => {
    it('returns all records for an employee', () => {
      repo.upsert('emp-1', 'loc-1', 'vacation', 10);
      repo.upsert('emp-1', 'loc-1', 'sick', 5);
      repo.upsert('emp-1', 'loc-2', 'vacation', 8);
      repo.upsert('emp-2', 'loc-1', 'vacation', 12);
      const records = repo.findByEmployee('emp-1');
      expect(records).toHaveLength(3);
      expect(records.every(r => r.employeeId === 'emp-1')).toBe(true);
    });
  });

  describe('batchUpsert', () => {
    it('upserts multiple records atomically', () => {
      repo.batchUpsert([
        { employeeId: 'emp-1', locationId: 'loc-1', leaveType: 'vacation', balance: 10 },
        { employeeId: 'emp-1', locationId: 'loc-1', leaveType: 'sick', balance: 5 },
        { employeeId: 'emp-2', locationId: 'loc-1', leaveType: 'vacation', balance: 8 },
      ]);
      expect(repo.findOne('emp-1', 'loc-1', 'vacation')!.balance).toBe(10);
      expect(repo.findOne('emp-1', 'loc-1', 'sick')!.balance).toBe(5);
      expect(repo.findOne('emp-2', 'loc-1', 'vacation')!.balance).toBe(8);
    });
  });

  describe('withAdvisoryLock', () => {
    it('serializes concurrent calls for the same key', async () => {
      const results: number[] = [];
      repo.upsert('emp-1', 'loc-1', 'vacation', 10);

      await Promise.all([
        repo.withAdvisoryLock('emp-1:loc-1:vacation', async () => {
          await new Promise(r => setTimeout(r, 20));
          results.push(1);
        }),
        repo.withAdvisoryLock('emp-1:loc-1:vacation', async () => {
          results.push(2);
        }),
      ]);

      expect(results).toEqual([1, 2]);
    });

    it('allows concurrent calls for different keys', async () => {
      const started: string[] = [];
      await Promise.all([
        repo.withAdvisoryLock('emp-1:loc-1:vacation', async () => {
          started.push('A');
          await new Promise(r => setTimeout(r, 20));
        }),
        repo.withAdvisoryLock('emp-2:loc-1:vacation', async () => {
          started.push('B');
        }),
      ]);
      expect(started).toContain('A');
      expect(started).toContain('B');
    });
  });
});