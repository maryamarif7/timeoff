import { v4 as uuidv4 } from 'uuid';

export function generateIdempotencyKey(prefix: string, ...parts: string[]): string {
  return `${prefix}:${parts.join(':')}`;
}

export function generateId(): string {
  return uuidv4();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function futureIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}