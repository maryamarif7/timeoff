import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

export interface LeaveParams {
  employeeId: string;
  locationId: string;
  leaveType: string;
  days: number;
}

export class HcmBalanceError extends Error {
  isHcmBalanceError = true;
  constructor(message: string) {
    super(message);
    this.name = 'HcmBalanceError';
  }
}

@Injectable()
export class HcmClientService {
  private readonly client: AxiosInstance;
  private readonly logger = new Logger(HcmClientService.name);
  private readonly maxRetries: number;

  constructor(private readonly config: ConfigService) {
    this.maxRetries = config.get<number>('hcm.maxRetries') ?? 5;
    this.client = axios.create({
      baseURL: config.get<string>('hcm.baseUrl'),
      timeout: config.get<number>('hcm.timeoutMs') ?? 5000,
      headers: { 'x-api-key': config.get<string>('hcm.apiKey') ?? '' },
    });
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = this.maxRetries): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        // Don't retry balance/dimension errors
        if (err.isHcmBalanceError) throw err;
        const status = (err as AxiosError).response?.status;
        if (status && status < 500 && status !== 429) throw err;
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
          this.logger.warn(`HCM call failed (attempt ${attempt + 1}), retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  async validateLeave(params: LeaveParams): Promise<{ valid: boolean; reason?: string }> {
    return this.withRetry(async () => {
      const res = await this.client.post('/leave/validate', params);
      return res.data;
    });
  }

  async deductLeave(
    params: LeaveParams,
    opts: { idempotencyKey: string },
  ): Promise<{ reference: string; success: boolean }> {
    return this.withRetry(async () => {
      const res = await this.client.post('/leave/deduct', params, {
        headers: { 'x-idempotency-key': opts.idempotencyKey },
      });
      const data = res.data;
      // Defensive: treat success=false as an error even if HTTP 200
      if (data.success === false || (!data.reference && !data.success)) {
        throw new HcmBalanceError(data.message ?? 'HCM silent failure on deduction');
      }
      if (!data.reference) {
        throw new HcmBalanceError('HCM returned no reference — treating as silent failure');
      }
      return data;
    });
  }

  async creditLeave(params: LeaveParams & { hcmRef?: string }): Promise<void> {
    return this.withRetry(async () => {
      await this.client.post('/leave/credit', params);
    });
  }

  async fetchBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<{ balance: number; version: string }> {
    return this.withRetry(async () => {
      const res = await this.client.get(`/balance/${employeeId}/${locationId}/${leaveType}`);
      return res.data;
    });
  }
}