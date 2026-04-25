import { IsString, IsNumber, IsOptional, IsNotEmpty, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BatchSyncItemDto {
  @IsString() @IsNotEmpty() employeeId: string;
  @IsString() @IsNotEmpty() locationId: string;
  @IsString() @IsNotEmpty() leaveType: string;
  @IsNumber() @Min(0) @Type(() => Number) balance: number;
  @IsString() @IsOptional() hcmVersion?: string;
}

export class BatchSyncDto {
  items: BatchSyncItemDto[];
}

export class BalanceResponseDto {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
  lockedDays: number;
  availableBalance: number;
  hcmVersion?: string;
  syncedAt: string;
}