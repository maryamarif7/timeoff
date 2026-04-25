import {
  Controller, Post, Body, Headers, RawBodyRequest,
  BadRequestException, HttpCode, SetMetadata, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService, BalanceUpdateEvent } from './webhooks.service';
import { ConfigService } from '@nestjs/config';
import { verifyHmac } from '../common/utills/hmac.util';
import { IsString, IsNumber, IsOptional, IsNotEmpty, Min } from 'class-validator';

class BalanceUpdateDto implements BalanceUpdateEvent {
  @IsString() @IsNotEmpty() employeeId: string;
  @IsString() @IsNotEmpty() locationId: string;
  @IsString() @IsNotEmpty() leaveType: string;
  @IsNumber() @Min(0) balance: number;
  @IsString() @IsOptional() hcmVersion?: string;
  @IsString() @IsOptional() reason?: string;
}

@Controller('webhooks/hcm')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly config: ConfigService,
  ) {}

  @Post('balance-update')
  @HttpCode(200)
  @SetMetadata('isPublic', true)
  async handleBalanceUpdate(
    @Headers('x-event-id') eventId: string,
    @Headers('x-signature') signature: string,
    @Body() body: BalanceUpdateDto,
    @Req() req: Request,
  ) {
    if (!eventId) throw new BadRequestException('Missing X-Event-Id header');

    const secret = this.config.get<string>('hcm.webhookSecret') ?? '';
    if (secret) {
      const rawBody = JSON.stringify(body);
      if (!signature || !verifyHmac(secret, rawBody, signature)) {
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    return this.webhooksService.handleBalanceUpdate(eventId, body);
  }
}