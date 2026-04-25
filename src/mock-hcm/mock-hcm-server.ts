import * as express from 'express';
import  { Request, Response, NextFunction } from 'express';
import { Server } from 'http';

export type MockScenario =
  | 'normal'
  | 'insufficient_balance'
  | 'invalid_dimension'
  | 'silent_fail'
  | 'timeout'
  | 'server_error';

interface CallRecord {
  method: string;
  path: string;
  body: any;
  headers: any;
  timestamp: string;
}

type BalanceStore = Record<string, number>;

export class MockHcmServer {
  private readonly app = express();
  private server: Server | null = null;
  private scenario: MockScenario = 'normal';
  private balances: BalanceStore = {};
  private callLog: CallRecord[] = [];
  private referenceCounter = 1;

  constructor() {
    this.app.use(express.json());
    this.registerRoutes();
  }

  private key(employeeId: string, locationId: string, leaveType: string): string {
    return `${employeeId}:${locationId}:${leaveType}`;
  }

  private registerRoutes(): void {
    // Intercept all calls for logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/__mock')) {
        this.callLog.push({
          method: req.method,
          path: req.path,
          body: req.body,
          headers: req.headers,
          timestamp: new Date().toISOString(),
        });
      }
      next();
    });

    
    this.app.post('/__mock/config', (req: Request, res: Response) => {
      if (req.body.scenario) this.scenario = req.body.scenario;
      if (req.body.balances) Object.assign(this.balances, req.body.balances);
      this.callLog = [];
      res.json({ ok: true, scenario: this.scenario });
    });

    this.app.get('/__mock/calls', (_req: Request, res: Response) => {
      res.json(this.callLog);
    });

    this.app.get('/__mock/state', (_req: Request, res: Response) => {
      res.json({ scenario: this.scenario, balances: this.balances });
    });

    this.app.post('/__mock/reset', (_req: Request, res: Response) => {
      this.scenario = 'normal';
      this.balances = {};
      this.callLog = [];
      res.json({ ok: true });
    });

    this.app.post('/__mock/trigger-bonus', (req: Request, res: Response) => {
      const { employeeId, locationId, leaveType, bonusDays } = req.body;
      const k = this.key(employeeId, locationId, leaveType);
      this.balances[k] = (this.balances[k] ?? 0) + bonusDays;
      res.json({ ok: true, newBalance: this.balances[k] });
    });

   
    this.app.post('/leave/validate', (req: Request, res: Response) => {
      if (this.scenario === 'timeout') return;
      if (this.scenario === 'server_error') {
        return void res.status(503).json({ error: 'HCM unavailable' });
      }
      if (this.scenario === 'invalid_dimension') {
        return void res.json({ valid: false, reason: 'Invalid dimension combination' });
      }
      const { employeeId, locationId, leaveType, days } = req.body;
      const balance = this.balances[this.key(employeeId, locationId, leaveType)] ?? 10;
      if (this.scenario === 'insufficient_balance' || balance < days) {
        return void res.json({ valid: false, reason: 'Insufficient balance' });
      }
      res.json({ valid: true });
    });

    
    this.app.post('/leave/deduct', (req: Request, res: Response) => {
      if (this.scenario === 'timeout') return;
      if (this.scenario === 'server_error') {
        return void res.status(503).json({ error: 'HCM unavailable' });
      }
      if (this.scenario === 'insufficient_balance') {
        return void res.status(422).json({
          success: false,
          message: 'Insufficient balance in HCM',
          isBalanceError: true,
        });
      }
      if (this.scenario === 'invalid_dimension') {
        return void res.status(422).json({
          success: false,
          message: 'Invalid dimension combination',
          isBalanceError: true,
        });
      }
      if (this.scenario === 'silent_fail') {
        // Looks like a success, but we don't actually deduct the balance
        return void res.json({
          success: true,
          reference: `hcm-silent-${this.referenceCounter++}`,
        });
      }
      const { employeeId, locationId, leaveType, days } = req.body;
      const k = this.key(employeeId, locationId, leaveType);
      const current = this.balances[k] ?? 10;
      if (current < days) {
        return void res.status(422).json({
          success: false,
          message: 'Insufficient balance in HCM',
          isBalanceError: true,
        });
      }
      this.balances[k] = current - days;
      res.json({ success: true, reference: `hcm-ref-${this.referenceCounter++}` });
    });

    // ── Leave credit ──────────────────────────────────────────────────────
    this.app.post('/leave/credit', (req: Request, res: Response) => {
      if (this.scenario === 'timeout') return;
      if (this.scenario === 'server_error') {
        return void res.status(503).json({ error: 'HCM unavailable' });
      }
      const { employeeId, locationId, leaveType, days } = req.body;
      const k = this.key(employeeId, locationId, leaveType);
      this.balances[k] = (this.balances[k] ?? 0) + days;
      res.json({ success: true });
    });

    // ── Fetch balance ─────────────────────────────────────────────────────
    this.app.get('/balance/:employeeId/:locationId/:leaveType', (req: Request, res: Response) => {
      if (this.scenario === 'timeout') return;
      if (this.scenario === 'server_error') {
        return void res.status(503).json({ error: 'HCM unavailable' });
      }
      const { employeeId, locationId, leaveType } = req.params;
      const balance = this.balances[this.key(employeeId, locationId, leaveType)] ?? 10;
      res.json({ balance, version: `v-${Date.now()}` });
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, (err?: Error) => {
        if (err) return reject(err);
        const addr = this.server!.address() as { port: number };
        resolve(addr.port);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // ── Test helpers ───────────────────────────────────────────────────────

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  setBalance(employeeId: string, locationId: string, leaveType: string, amount: number): void {
    this.balances[this.key(employeeId, locationId, leaveType)] = amount;
  }

  getBalance(employeeId: string, locationId: string, leaveType: string): number {
    return this.balances[this.key(employeeId, locationId, leaveType)] ?? 10;
  }

  getCallLog(): CallRecord[] {
    return [...this.callLog];
  }

  getCallsTo(path: string): CallRecord[] {
    return this.callLog.filter(c => c.path === path);
  }

  reset(): void {
    this.scenario = 'normal';
    this.balances = {};
    this.callLog = [];
  }
}