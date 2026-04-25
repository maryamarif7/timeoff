import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';

export class CreateRequestDto {
  @IsString() @IsNotEmpty() locationId: string;
  @IsString() @IsNotEmpty() leaveType: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsString() @IsOptional() notes?: string;
}

export class RejectRequestDto {
  @IsString() @IsNotEmpty() reason: string;
}

export class ApproveRequestDto {
  @IsString() @IsOptional() notes?: string;
}